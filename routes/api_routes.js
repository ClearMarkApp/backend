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