const express = require('express');
const router = express.Router();
const getControllers = require('../controllers/api_GET_controllers');


// GET routes
// Get course details with assignments and users
router.get('/courses/:courseId', getControllers.getCourseDetail);

// Get assignment details
router.get('/assignments/:assignmentId', getControllers.getAssignmentInfo);

// Get student submission with grades
router.get('/assignments/:assignmentId/students/:studentId/submission', getControllers.getUserSubmission);

module.exports = router;

// DELETE routes

// Delete a course
router.delete('/courses/:courseId', deleteControllers.deleteCourse);
// Delete an enrollment (remove user from course)
router.delete('/enrollments/:enrollmentId', deleteControllers.deleteEnrollment);
// Delete a question
router.delete('/questions/:questionId', deleteControllers.deleteQuestion);