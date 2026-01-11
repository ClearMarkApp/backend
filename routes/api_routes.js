const express = require('express');
const router = express.Router();
const multer = require('multer');
const getControllers = require('../controllers/api_GET_controllers');
const postControllers = require('../controllers/api_POST_controllers');
const deleteControllers = require('../controllers/api_DELETE_controllers');
const putControllers = require('../controllers/api_PUT_controllers');

// Multer configuration for file uploads (memory storage for R2 upload)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});

// GET routes
// Get course details with assignments and users
router.get('/courses/:courseId', getControllers.getCourseDetail);
// Get assignment details
router.get('/assignments/:assignmentId', getControllers.getAssignmentInfo);
// Get student submission with grades
router.get('/assignments/:assignmentId/students/:studentId/submission', getControllers.getUserSubmission);
// AI grade a student's submission
router.get('/assignments/:assignmentId/user/:userId/ai-grading', getControllers.aiGradeSubmission);
// Export assignment submissions and grades as CSV
router.get('/assignments/:assignmentId/export', getControllers.exportAssignmentCsv);
// Check if a user exists by email
router.get("/users/check-exists/:email", getControllers.checkUserExists);


// DELETE routes

// Delete a course
router.delete('/courses/:courseId', deleteControllers.deleteCourse);
// Delete an enrollment (remove user from course)
router.delete('/enrollments/:enrollmentId', deleteControllers.deleteEnrollment);
// Delete a question
router.delete('/questions/:questionId', deleteControllers.deleteQuestion);

// PUT routes

// Update grading guidelines for an assignment
router.put("/assignments/grading-guidelines", putControllers.updateGradingGuidelines);
// Update question on an assignment
router.put("/questions", putControllers.updateQuestion);
// Update grade for a student's submission
router.put("/grades", putControllers.updateGrade);
// Update user role in a course
router.put("/enrollments/role", putControllers.updateRole);

// POST routes
// Create a new question in an assignment
router.post('/questions', postControllers.createQuestion);
// Post email and get all classes for a user
router.post('/users/classes', postControllers.postUserClasses);
// Create a new assignment in a course
router.post("/assignments", postControllers.createAssignment);
// Create a new course for a user (owner)
router.post("/courses", postControllers.createCourse);
// Create a new enrollment for a user in a course
router.post("/enrollments", postControllers.createEnrollment);
// Create a new user
router.post("/users", postControllers.createUser);
// Upload PDF submission
router.post("/users/:userId/assignments/:assignmentId/upload", (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.message === 'Only PDF files are allowed') {
        return res.status(400).json({ error: err.message });
      }
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum size is 50MB' });
      }
      return res.status(400).json({ error: 'File upload failed' });
    }
    next();
  });
}, postControllers.uploadSubmission);

module.exports = router;