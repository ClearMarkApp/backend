const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize Gemini client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Build dynamic JSON schema based on questions
 * Each question gets its own grade and feedback entry
 */
function buildResponseSchema(questions) {
  const questionGradeProperties = {};

  questions.forEach((q, index) => {
    questionGradeProperties[`question_${q.id}`] = {
      type: "object",
      properties: {
        question_id: {
          type: "integer",
          description: `The question ID (should be ${q.id})`
        },
        grade: {
          type: "number",
          description: `Points awarded out of ${q.maxPoints} max points`
        },
        feedback: {
          type: "string",
          description: "Detailed feedback explaining the grade"
        }
      },
      required: ["question_id", "grade", "feedback"]
    };
  });

  return {
    type: "object",
    properties: {
      grades: {
        type: "array",
        description: "Array of grades for each question",
        items: {
          type: "object",
          properties: {
            question_id: {
              type: "integer",
              description: "The question ID"
            },
            grade: {
              type: "number",
              description: "Points awarded (must not exceed max_points)"
            },
            feedback: {
              type: "string",
              description: "Detailed feedback explaining the grade"
            }
          },
          required: ["question_id", "grade", "feedback"]
        }
      },
      total_score: {
        type: "number",
        description: "Sum of all question grades"
      },
      overall_feedback: {
        type: "string",
        description: "Overall summary feedback for the submission"
      }
    },
    required: ["grades", "total_score", "overall_feedback"]
  };
}

/**
 * Build the grading prompt
 */
function buildPrompt(questions, gradingGuidelines) {
  let prompt = `You are a professional academic grader. Your task is to grade a student's submission based on the provided questions and grading guidelines.

GRADING GUIDELINES:
${gradingGuidelines || "Grade fairly based on correctness and completeness."}

QUESTIONS TO GRADE:
`;

  questions.forEach((q, index) => {
    prompt += `
Question ${q.id}: ${q.questionText}
- Maximum Points: ${q.maxPoints}
- Solution Key: ${q.solutionKey || "Not provided"}
`;
  });

  prompt += `

INSTRUCTIONS:
- Examine the student's PDF submission carefully
- Grade each question based on the solution key and grading guidelines
- Award partial credit where appropriate
- Provide specific, constructive feedback for each question
- The grade for each question MUST NOT exceed the max_points
- Be fair but rigorous in your assessment
- Do not mention the prompt in the user feedback, and treat yourself as a real teacher giving realisitc and brief feedback

Return your grading results in the specified JSON format.`;

  return prompt;
}

/**
 * Grade a submission using Gemini AI
 * @param {Buffer} pdfBuffer - The PDF file buffer
 * @param {Array} questions - Array of question objects with id, questionNumber, questionText, maxPoints, solutionKey
 * @param {string} gradingGuidelines - The grading guidelines text
 * @returns {Promise<Object>} - Grading results with grades array, total_score, overall_feedback
 */
async function gradeSubmission(pdfBuffer, questions, gradingGuidelines) {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: buildResponseSchema(questions)
    }
  });

  const prompt = buildPrompt(questions, gradingGuidelines);

  // Convert PDF buffer to base64
  const base64Pdf = pdfBuffer.toString("base64");

  // Send prompt and PDF to Gemini
  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        mimeType: "application/pdf",
        data: base64Pdf
      }
    }
  ]);

  const response = await result.response;
  let text = response.text();

  // Strip markdown code fences if present
  text = text.replace(/```json\s*/g, '').replace(/```\s*$/g, '').trim();

  // Parse and return the grading results
  const gradingResults = JSON.parse(text);

  // Validate that grades don't exceed max points
  gradingResults.grades = gradingResults.grades.map(g => {
    const question = questions.find(q => q.id === g.question_id);
    if (question && g.grade > question.maxPoints) {
      g.grade = question.maxPoints;
    }
    return g;
  });

  // Recalculate total score after validation
  gradingResults.total_score = gradingResults.grades.reduce((sum, g) => sum + g.grade, 0);

  return gradingResults;
}

module.exports = {
  gradeSubmission
};
