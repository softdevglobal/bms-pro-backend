const express = require('express');
const admin = require('../firebaseAdmin');
const emailService = require('../services/emailService');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

// Helper function to create notification and send email
async function createNotificationAndSendEmail(userId, userEmail, notificationData) {
  try {
    // Check if a similar notification already exists to prevent duplicates
    // Using a simpler query that doesn't require composite indexes
    let existingNotification = null;
    
    try {
      const existingNotifications = await admin.firestore()
        .collection('notifications')
        .where('userId', '==', userId)
        .where('type', '==', notificationData.type)
        .limit(10) // Get a few recent notifications of this type
        .get();

      // Check if any of these notifications have the same bookingId
      existingNotifications.docs.forEach(doc => {
        const data = doc.data();
        if (data.data?.bookingId === notificationData.data?.bookingId) {
          existingNotification = doc;
        }
      });
    } catch (indexError) {
      console.log('Index query failed, using alternative duplicate check:', indexError.message);
      
      // Fallback: Get recent notifications for this user and check manually
      const recentNotifications = await admin.firestore()
        .collection('notifications')
        .where('userId', '==', userId)
        .orderBy('createdAt', 'desc')
        .limit(20)
        .get();

      recentNotifications.docs.forEach(doc => {
        const data = doc.data();
        if (data.type === notificationData.type && 
            data.data?.bookingId === notificationData.data?.bookingId) {
          existingNotification = doc;
        }
      });
    }

    if (existingNotification) {
      console.log('Duplicate notification prevented for booking:', notificationData.data?.bookingId);
      return existingNotification.id;
    }

    // Create notification in Firestore
    const notificationDoc = await admin.firestore().collection('notifications').add({
      userId: userId,
      type: notificationData.type,
      title: notificationData.title,
      message: notificationData.message,
      data: notificationData.data || null,
      isRead: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log('Notification created:', notificationDoc.id);

    // Send email notification if user email is provided
    if (userEmail) {
      try {
        await emailService.sendNotificationEmail(notificationData, userEmail);
        console.log('Email sent successfully to:', userEmail);
      } catch (emailError) {
        console.error('Failed to send email to:', userEmail, emailError.message);
        // Don't fail the notification creation if email fails
      }
    }

    return notificationDoc.id;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
}


// POST /api/bookings/admin - Create a new booking (admin endpoint for hall owners)
router.post('/admin', verifyToken, async (req, res) => {
  try {
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
    const userId = req.user.uid || req.user.user_id;
    const {
      customerName,
      customerEmail,
      customerPhone,
      eventType,
      selectedHall,
      bookingDate,
      startTime,
      endTime,
      additionalDescription,
      estimatedPrice,
      customerAvatar,
      guestCount,
      status = 'pending' // Admin can set initial status
    } = req.body;

    // Debug: Log the received date
    console.log('Admin booking API - Date received:', {
      originalDate: bookingDate,
      dateType: typeof bookingDate,
      dateValue: bookingDate,
      parsedDate: new Date(bookingDate),
      isoString: new Date(bookingDate).toISOString()
    });

    // Validate required fields
    if (!customerName || !customerEmail || !customerPhone || !eventType || !selectedHall || !bookingDate || !startTime || !endTime) {
      return res.status(400).json({
        message: 'Missing required fields: customerName, customerEmail, customerPhone, eventType, selectedHall, bookingDate, startTime, endTime'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerEmail)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Validate phone format (basic validation)
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
    if (!phoneRegex.test(customerPhone.replace(/[\s\-\(\)]/g, ''))) {
      return res.status(400).json({ message: 'Invalid phone number format' });
    }

    // Validate date format and ensure it's not in the past
    const bookingDateObj = new Date(bookingDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (isNaN(bookingDateObj.getTime())) {
      return res.status(400).json({ message: 'Invalid booking date format' });
    }
    
    if (bookingDateObj < today) {
      return res.status(400).json({ message: 'Booking date cannot be in the past' });
    }

    // Validate time format
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
      return res.status(400).json({ message: 'Invalid time format. Use HH:MM format' });
    }

    // Validate that end time is after start time
    const startTimeObj = new Date(`2000-01-01T${startTime}:00`);
    const endTimeObj = new Date(`2000-01-01T${endTime}:00`);
    
    if (endTimeObj <= startTimeObj) {
      return res.status(400).json({ message: 'End time must be after start time' });
    }

    // Validate status
    if (!['pending', 'confirmed', 'cancelled', 'completed'].includes(status)) {
      return res.status(400).json({
        message: 'Invalid status. Must be one of: pending, confirmed, cancelled, completed'
      });
    }

    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = userId;
    
    if (userData.role === 'sub_user') {
      // For sub_users, use their parent user ID as the hall owner ID
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
    } else if (userData.role !== 'hall_owner') {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can create bookings.' });
    }

    // Verify selected hall exists and belongs to the hall owner
    const hallDoc = await admin.firestore().collection('resources').doc(selectedHall).get();
    if (!hallDoc.exists) {
      return res.status(404).json({ message: 'Selected hall not found' });
    }

    const hallData = hallDoc.data();
    if (hallData.hallOwnerId !== actualHallOwnerId) {
      return res.status(400).json({ message: 'Selected hall does not belong to the specified hall owner' });
    }

    // Check for conflicting bookings
    const conflictingBookings = await admin.firestore()
      .collection('bookings')
      .where('hallOwnerId', '==', actualHallOwnerId)
      .where('selectedHall', '==', selectedHall)
      .where('bookingDate', '==', bookingDate)
      .where('status', 'in', ['pending', 'confirmed'])
      .get();

    // Check for time conflicts
    for (const bookingDoc of conflictingBookings.docs) {
      const booking = bookingDoc.data();
      const existingStart = new Date(`2000-01-01T${booking.startTime}:00`);
      const existingEnd = new Date(`2000-01-01T${booking.endTime}:00`);
      
      // Check if times overlap
      if ((startTimeObj < existingEnd && endTimeObj > existingStart)) {
        return res.status(409).json({
          message: 'Time slot is already booked. Please choose a different time.',
          conflictingBooking: {
            startTime: booking.startTime,
            endTime: booking.endTime,
            customerName: booking.customerName
          }
        });
      }
    }

    // Calculate booking price using the same logic as customer bookings
    let calculatedPrice = 0;
    let priceDetails = null;
    
    try {
      // Get pricing for the selected hall
      const pricingSnapshot = await admin.firestore()
        .collection('pricing')
        .where('hallOwnerId', '==', actualHallOwnerId)
        .where('resourceId', '==', selectedHall)
        .get();
      
      if (!pricingSnapshot.empty) {
        const pricingData = pricingSnapshot.docs[0].data();
        
        // Calculate duration in hours - use the actual booking date to avoid timezone issues
        const startTimeObj = new Date(`${bookingDate}T${startTime}:00`);
        const endTimeObj = new Date(`${bookingDate}T${endTime}:00`);
        const durationHours = (endTimeObj.getTime() - startTimeObj.getTime()) / (1000 * 60 * 60);
        
        // Debug: Log the time calculation
        console.log('Admin booking - Time calculation:', {
          bookingDate: bookingDate,
          startTime: startTime,
          endTime: endTime,
          startTimeObj: startTimeObj.toISOString(),
          endTimeObj: endTimeObj.toISOString(),
          durationHours: durationHours
        });
        
        // Check if it's weekend (Saturday = 6, Sunday = 0)
        const bookingDateObj = new Date(bookingDate);
        const isWeekend = bookingDateObj.getDay() === 0 || bookingDateObj.getDay() === 6;
        
        const rate = isWeekend ? pricingData.weekendRate : pricingData.weekdayRate;
        
        if (pricingData.rateType === 'hourly') {
          calculatedPrice = rate * durationHours;
        } else {
          // For daily rates, assume minimum 4 hours for half day, 8+ hours for full day
          calculatedPrice = durationHours >= 8 ? rate : rate * 0.5;
        }
        
        priceDetails = {
          rateType: pricingData.rateType,
          weekdayRate: pricingData.weekdayRate,
          weekendRate: pricingData.weekendRate,
          appliedRate: rate,
          durationHours: durationHours,
          isWeekend: isWeekend,
          calculationMethod: pricingData.rateType === 'hourly' ? 'hourly' : 'daily',
          frontendEstimatedPrice: estimatedPrice || null
        };
        
        console.log('Admin booking price calculation:', {
          resourceId: selectedHall,
          rateType: pricingData.rateType,
          weekdayRate: pricingData.weekdayRate,
          weekendRate: pricingData.weekendRate,
          appliedRate: rate,
          durationHours: durationHours,
          isWeekend: isWeekend,
          calculatedPrice: calculatedPrice,
          adminEstimatedPrice: estimatedPrice
        });
      } else {
        console.log('No pricing found for hall, using estimated price or default');
        calculatedPrice = estimatedPrice || 0;
      }
    } catch (priceError) {
      console.error('Error calculating price:', priceError);
      // Use estimated price if calculation fails
      calculatedPrice = estimatedPrice || 0;
    }

    // Create booking data
    const bookingData = {
      customerId: null, // Admin-created bookings don't have a customer Firebase UID
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim().toLowerCase(),
      customerPhone: customerPhone.trim(),
      customerAvatar: customerAvatar || null,
      eventType: eventType.trim(),
      selectedHall: selectedHall,
      hallName: hallData.name,
      bookingDate: bookingDate,
      startTime: startTime,
      endTime: endTime,
      additionalDescription: additionalDescription ? additionalDescription.trim() : '',
      guestCount: guestCount ? parseInt(guestCount) : null,
      hallOwnerId: actualHallOwnerId,
      status: status,
      calculatedPrice: calculatedPrice,
      priceDetails: priceDetails,
      bookingSource: 'admin', // Track that this was created by admin
      createdBy: userId, // Track which admin created this booking
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Debug: Log the final booking data
    console.log('Admin booking - Final booking data:', {
      bookingDate: bookingData.bookingDate,
      startTime: bookingData.startTime,
      endTime: bookingData.endTime,
      customerName: bookingData.customerName,
      eventType: bookingData.eventType
    });

    // Save to Firestore
    const docRef = await admin.firestore().collection('bookings').add(bookingData);

    console.log('Admin booking created successfully:', {
      bookingId: docRef.id,
      customerName: customerName,
      customerEmail: customerEmail,
      hallOwnerId: actualHallOwnerId,
      selectedHall: selectedHall,
      bookingDate: bookingDate,
      createdBy: userId
    });

    // Log booking creation
    const AuditService = require('../services/auditService');
    await AuditService.logBookingCreated(
      userId,
      req.user.email,
      userData.role,
      {
        id: docRef.id,
        customerName: customerName,
        eventDate: bookingDate,
        status: status,
        totalAmount: calculatedPrice || estimatedPrice || 0
      },
      ipAddress,
      actualHallOwnerId
    );

    // Get the created booking with ID
    const createdBooking = {
      id: docRef.id,
      ...bookingData,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Send email notification to customer for admin-created bookings (same as regular bookings)
    if (customerEmail) {
      try {
        console.log('Sending booking confirmation email for admin-created booking:', {
          customerEmail: customerEmail,
          customerName: customerName,
          bookingId: docRef.id,
          eventType: eventType,
          bookingDate: bookingDate,
          status: status
        });

        // Send the same type of email as regular bookings
        const notificationData = {
          type: 'booking_confirmation',
          title: `Booking ${status.charAt(0).toUpperCase() + status.slice(1)} - ${eventType}`,
          message: `Hello ${customerName},\n\nYour booking has been ${status}.\n\nEvent: ${eventType}\nDate: ${bookingDate}\nTime: ${startTime} - ${endTime}\nHall: ${hallData.name}${calculatedPrice ? `\nTotal Cost: $${calculatedPrice.toFixed(2)}` : ''}${additionalDescription ? `\n\nNotes: ${additionalDescription}` : ''}\n\nThank you for choosing our venue!`,
          data: {
            bookingId: docRef.id,
            customerName: customerName,
            eventType: eventType,
            hallName: hallData.name,
            bookingDate: bookingDate,
            startTime: startTime,
            endTime: endTime,
            status: status,
            calculatedPrice: calculatedPrice,
            createdBy: 'admin',
            additionalDescription: additionalDescription || ''
          }
        };

        await emailService.sendNotificationEmail(notificationData, customerEmail);
        console.log('Booking confirmation email sent successfully to:', customerEmail);
      } catch (emailError) {
        console.error('Failed to send booking confirmation email:', emailError);
        // Don't fail the booking creation if email fails
      }
    }

    res.status(201).json({
      message: 'Admin booking created successfully',
      booking: createdBooking
    });

  } catch (error) {
    console.error('Error creating admin booking:', error);
    res.status(500).json({ message: error.message });
  }
});

// POST /api/bookings - Create a new booking (public endpoint for customers)
router.post('/', async (req, res) => {
  try {
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
    const {
      customerId,
      customerName,
      customerEmail,
      customerPhone,
      eventType,
      selectedHall,
      bookingDate,
      startTime,
      endTime,
      additionalDescription,
      hallOwnerId,
      estimatedPrice,
      customerAvatar,
      guestCount,
      bookingSource
    } = req.body;

    // Validate required fields
    if (!customerName || !customerEmail || !customerPhone || !eventType || !selectedHall || !bookingDate || !startTime || !endTime || !hallOwnerId) {
      return res.status(400).json({
        message: 'Missing required fields: customerName, customerEmail, customerPhone, eventType, selectedHall, bookingDate, startTime, endTime, hallOwnerId'
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerEmail)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // Validate phone format (basic validation)
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
    if (!phoneRegex.test(customerPhone.replace(/[\s\-\(\)]/g, ''))) {
      return res.status(400).json({ message: 'Invalid phone number format' });
    }

    // Validate date format and ensure it's not in the past
    const bookingDateObj = new Date(bookingDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (isNaN(bookingDateObj.getTime())) {
      return res.status(400).json({ message: 'Invalid booking date format' });
    }
    
    if (bookingDateObj < today) {
      return res.status(400).json({ message: 'Booking date cannot be in the past' });
    }

    // Validate time format
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
      return res.status(400).json({ message: 'Invalid time format. Use HH:MM format' });
    }

    // Validate that end time is after start time
    const startTimeObj = new Date(`2000-01-01T${startTime}:00`);
    const endTimeObj = new Date(`2000-01-01T${endTime}:00`);
    
    if (endTimeObj <= startTimeObj) {
      return res.status(400).json({ message: 'End time must be after start time' });
    }

    // Verify hall owner exists
    const hallOwnerDoc = await admin.firestore().collection('users').doc(hallOwnerId).get();
    if (!hallOwnerDoc.exists) {
      return res.status(404).json({ message: 'Hall owner not found' });
    }

    const hallOwnerData = hallOwnerDoc.data();
    if (hallOwnerData.role !== 'hall_owner') {
      return res.status(404).json({ message: 'Hall owner not found' });
    }

    // Verify selected hall exists and belongs to the hall owner
    const hallDoc = await admin.firestore().collection('resources').doc(selectedHall).get();
    if (!hallDoc.exists) {
      return res.status(404).json({ message: 'Selected hall not found' });
    }

    const hallData = hallDoc.data();
    if (hallData.hallOwnerId !== hallOwnerId) {
      return res.status(400).json({ message: 'Selected hall does not belong to the specified hall owner' });
    }

    // Check for conflicting bookings
    const conflictingBookings = await admin.firestore()
      .collection('bookings')
      .where('hallOwnerId', '==', hallOwnerId)
      .where('selectedHall', '==', selectedHall)
      .where('bookingDate', '==', bookingDate)
      .where('status', 'in', ['pending', 'confirmed'])
      .get();

    // Check for time conflicts
    for (const bookingDoc of conflictingBookings.docs) {
      const booking = bookingDoc.data();
      const existingStart = new Date(`2000-01-01T${booking.startTime}:00`);
      const existingEnd = new Date(`2000-01-01T${booking.endTime}:00`);
      
      // Check if times overlap
      if ((startTimeObj < existingEnd && endTimeObj > existingStart)) {
        return res.status(409).json({
          message: 'Time slot is already booked. Please choose a different time.',
          conflictingBooking: {
            startTime: booking.startTime,
            endTime: booking.endTime,
            customerName: booking.customerName
          }
        });
      }
    }

    // Calculate booking price
    let calculatedPrice = 0;
    let priceDetails = null;
    
    try {
      // Get pricing for the selected hall
      const pricingSnapshot = await admin.firestore()
        .collection('pricing')
        .where('hallOwnerId', '==', hallOwnerId)
        .where('resourceId', '==', selectedHall)
        .get();
      
      if (!pricingSnapshot.empty) {
        const pricingData = pricingSnapshot.docs[0].data();
        
        // Calculate duration in hours
        const startTimeObj = new Date(`2000-01-01T${startTime}:00`);
        const endTimeObj = new Date(`2000-01-01T${endTime}:00`);
        const durationHours = (endTimeObj.getTime() - startTimeObj.getTime()) / (1000 * 60 * 60);
        
        // Check if it's weekend (Saturday = 6, Sunday = 0)
        const bookingDateObj = new Date(bookingDate);
        const isWeekend = bookingDateObj.getDay() === 0 || bookingDateObj.getDay() === 6;
        
        const rate = isWeekend ? pricingData.weekendRate : pricingData.weekdayRate;
        
        if (pricingData.rateType === 'hourly') {
          calculatedPrice = rate * durationHours;
        } else {
          // For daily rates, assume minimum 4 hours for half day, 8+ hours for full day
          calculatedPrice = durationHours >= 8 ? rate : rate * 0.5;
        }
        
        priceDetails = {
          rateType: pricingData.rateType,
          weekdayRate: pricingData.weekdayRate,
          weekendRate: pricingData.weekendRate,
          appliedRate: rate,
          durationHours: durationHours,
          isWeekend: isWeekend,
          calculationMethod: pricingData.rateType === 'hourly' ? 'hourly' : 'daily',
          frontendEstimatedPrice: estimatedPrice || null
        };
        
        console.log('Price calculation details:', {
          resourceId: selectedHall,
          rateType: pricingData.rateType,
          weekdayRate: pricingData.weekdayRate,
          weekendRate: pricingData.weekendRate,
          appliedRate: rate,
          durationHours: durationHours,
          isWeekend: isWeekend,
          calculatedPrice: calculatedPrice,
          frontendEstimatedPrice: estimatedPrice
        });
      }
    } catch (priceError) {
      console.error('Error calculating price:', priceError);
      // Continue with booking even if price calculation fails
    }

    // Create booking data
    const bookingData = {
      customerId: customerId || null, // Firebase UID of the customer (optional for backward compatibility)
      customerName: customerName.trim(),
      customerEmail: customerEmail.trim().toLowerCase(),
      customerPhone: customerPhone.trim(),
      customerAvatar: customerAvatar || null, // Customer avatar URL
      eventType: eventType.trim(),
      selectedHall: selectedHall,
      hallName: hallData.name, // Store hall name for easier reference
      bookingDate: bookingDate,
      startTime: startTime,
      endTime: endTime,
      additionalDescription: additionalDescription ? additionalDescription.trim() : '',
      guestCount: guestCount ? parseInt(guestCount) : null, // Number of guests
      hallOwnerId: hallOwnerId,
      status: 'pending', // New bookings start as pending
      calculatedPrice: calculatedPrice,
      priceDetails: priceDetails,
      bookingSource: bookingSource || 'website', // Track where booking came from
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Save to Firestore
    const docRef = await admin.firestore().collection('bookings').add(bookingData);

    console.log('Booking created successfully:', {
      bookingId: docRef.id,
      customerId: customerId,
      customerName: customerName,
      customerEmail: customerEmail,
      hallOwnerId: hallOwnerId,
      selectedHall: selectedHall,
      bookingDate: bookingDate,
      bookingSource: bookingSource || 'website'
    });

    // Log booking creation
    const AuditService = require('../services/auditService');
    await AuditService.logBookingCreated(
      'customer', // For public bookings, we don't have a specific user ID
      customerEmail,
      'customer',
      {
        id: docRef.id,
        customerName: customerName,
        eventDate: bookingDate,
        status: 'pending',
        totalAmount: estimatedPrice || 0
      },
      ipAddress,
      hallOwnerId
    );

    // Get the created booking with ID
    const createdBooking = {
      id: docRef.id,
      ...bookingData,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Send email notification for ALL bookings (regardless of customerId)
    if (customerEmail) {
      try {
        console.log('Sending email notification for booking:', {
          customerId: customerId || 'anonymous',
          customerEmail,
          bookingId: docRef.id,
          eventType,
          bookingDate
        });

        const priceMessage = calculatedPrice ? ` Estimated cost: $${calculatedPrice.toFixed(2)}.` : '';
        
        const notificationData = {
          type: 'booking_submitted',
          title: 'Booking Request Submitted',
          message: `Your booking request for ${eventType} on ${bookingDate} has been submitted successfully.${priceMessage} We'll get back to you soon with confirmation.`,
          data: {
            bookingId: docRef.id,
            eventType: eventType,
            bookingDate: bookingDate,
            startTime: startTime,
            endTime: endTime,
            calculatedPrice: calculatedPrice,
            hallName: hallData.name
          }
        };

        // Send email notification directly using emailService
        await emailService.sendNotificationEmail(notificationData, customerEmail);
        console.log('✅ Email notification sent successfully for booking:', {
          customerEmail,
          bookingId: docRef.id,
          eventType,
          bookingDate
        });

        // Also create notification in database if customerId exists (for authenticated users)
        if (customerId) {
          try {
            const notificationId = await createNotificationAndSendEmail(customerId, customerEmail, notificationData);
            console.log('Database notification created for authenticated user:', {
              customerId,
              notificationId,
              bookingId: docRef.id
            });
          } catch (notificationError) {
            console.error('Failed to create database notification (but email was sent):', notificationError);
          }
        }
      } catch (emailError) {
        console.error('❌ Failed to send email notification for booking:', emailError);
        
        // Try to send a simple fallback email
        try {
          console.log('Attempting to send fallback email notification...');
          const fallbackEmailData = {
            to: customerEmail,
            subject: `Booking Request Submitted - ${eventType}`,
            body: `Dear ${customerName},\n\nYour booking request for ${eventType} on ${bookingDate} has been submitted successfully.\n\nBooking Details:\n- Event: ${eventType}\n- Date: ${bookingDate}\n- Time: ${startTime} - ${endTime}\n- Resource: ${hallData.name}\n- Booking ID: ${docRef.id}\n\nWe'll get back to you soon with confirmation.\n\nThank you for choosing Cranbourne Public Hall!`,
            recipientName: customerName,
            bookingId: docRef.id,
            templateName: 'booking_submitted_fallback',
            isCustom: true
          };
          
          await emailService.sendCustomizedEmail(fallbackEmailData);
          console.log('✅ Fallback email notification sent successfully');
        } catch (fallbackError) {
          console.error('❌ Fallback email also failed:', fallbackError);
        }
        
        // Don't fail the booking creation if email fails
      }
    }

    res.status(201).json({
      message: 'Booking request submitted successfully',
      booking: createdBooking
    });

  } catch (error) {
    console.error('Error creating booking:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/bookings/hall-owner/:hallOwnerId - Get all bookings for a hall owner (requires authentication)
router.get('/hall-owner/:hallOwnerId', verifyToken, async (req, res) => {
  try {
    const { hallOwnerId } = req.params;
    // Handle both JWT and Firebase tokens - JWT has 'uid', Firebase has 'uid'
    const userId = req.user.uid || req.user.user_id;

    console.log('Request user object:', req.user);
    console.log('Extracted userId:', userId);
    console.log('Requested hallOwnerId:', hallOwnerId);

    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = hallOwnerId;
    
    if (userData.role === 'sub_user') {
      // For sub_users, use their parent user ID as the hall owner ID
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      // Verify the sub_user is trying to access their parent's data
      if (actualHallOwnerId !== hallOwnerId) {
        console.log('Sub-user parent ID mismatch:', { actualHallOwnerId, hallOwnerId });
        return res.status(403).json({ message: 'Access denied. You can only view your parent hall owner\'s bookings.' });
      }
    } else if (userData.role === 'hall_owner') {
      // For hall_owners, verify they are accessing their own data
      if (userId !== hallOwnerId) {
        console.log('User ID mismatch:', { userId, hallOwnerId });
        return res.status(403).json({ message: 'Access denied. You can only view your own bookings.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can view bookings.' });
    }

    // Get bookings for this hall owner with optional status filter
    const { status } = req.query;
    console.log('Fetching bookings for hallOwnerId:', actualHallOwnerId, 'with status filter:', status);
    
    let query = admin.firestore()
      .collection('bookings')
      .where('hallOwnerId', '==', actualHallOwnerId);
    
    // Add status filter if provided
    if (status) {
      query = query.where('status', '==', status.toLowerCase());
    }
    
    const bookingsSnapshot = await query.get();

    console.log(`Found ${bookingsSnapshot.docs.length} bookings${status ? ` with status '${status}'` : ''}`);

    const bookings = bookingsSnapshot.docs.map(doc => {
      const data = doc.data();
      console.log('Booking data:', { id: doc.id, hallOwnerId: data.hallOwnerId, customerName: data.customerName });
      return {
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || null,
        updatedAt: data.updatedAt?.toDate?.() || null
      };
    });

    // Sort bookings by createdAt in descending order (newest first)
    bookings.sort((a, b) => {
      if (!a.createdAt || !b.createdAt) return 0;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    console.log('Returning', bookings.length, 'bookings');
    res.json(bookings);

  } catch (error) {
    console.error('Error fetching bookings:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : 'Internal server error'
    });
  }
});

// PUT /api/bookings/:id/status - Update booking status (hall owner only)
router.put('/:id/status', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user.uid;
    const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

    // Validate status
    if (!['pending', 'confirmed', 'cancelled', 'completed'].includes(status)) {
      return res.status(400).json({
        message: 'Invalid status. Must be one of: pending, confirmed, cancelled, completed'
      });
    }

    // Get booking
    const bookingDoc = await admin.firestore().collection('bookings').doc(id).get();
    if (!bookingDoc.exists) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const bookingData = bookingDoc.data();
    const oldBookingData = { id, ...bookingData };
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = bookingData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      // For sub_users, verify they belong to the same hall owner
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      // Verify the sub_user is trying to update their parent's booking
      if (actualHallOwnerId !== bookingData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only update your parent hall owner\'s bookings.' });
      }
    } else if (userData.role === 'hall_owner') {
      // For hall_owners, verify they are updating their own booking
      if (bookingData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only update your own bookings.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can update booking status.' });
    }

    // Update booking status
    await admin.firestore().collection('bookings').doc(id).update({
      status: status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Log booking status update
    const AuditService = require('../services/auditService');
    const newBookingData = { ...oldBookingData, status: status };
    const hallId = actualHallOwnerId;
    
    if (status === 'confirmed') {
      await AuditService.logBookingConfirmed(
        userId,
        req.user.email,
        userData.role,
        { id, ...bookingData, status: status },
        ipAddress,
        hallId
      );
    } else if (status === 'cancelled') {
      await AuditService.logBookingCancelled(
        userId,
        req.user.email,
        userData.role,
        { id, ...oldBookingData },
        'Status updated by hall owner',
        ipAddress,
        hallId
      );
    } else {
      await AuditService.logBookingUpdated(
        userId,
        req.user.email,
        userData.role,
        { id, ...oldBookingData },
        { id, ...newBookingData },
        ipAddress,
        hallId
      );
    }

    // Create notification and send email for the customer if they have a customerId
    if (bookingData.customerId && bookingData.customerEmail) {
      try {
        let notificationTitle = '';
        let notificationMessage = '';
        
        switch (status) {
          case 'confirmed':
            notificationTitle = 'Booking Confirmed!';
            notificationMessage = `Great news! Your booking for ${bookingData.eventType} on ${bookingData.bookingDate} has been confirmed. We look forward to hosting your event!`;
            break;
          case 'cancelled':
            notificationTitle = 'Booking Cancelled';
            notificationMessage = `Your booking for ${bookingData.eventType} on ${bookingData.bookingDate} has been cancelled. Please contact us if you have any questions.`;
            break;
          case 'completed':
            notificationTitle = 'Event Completed';
            notificationMessage = `Thank you for choosing us! Your ${bookingData.eventType} event on ${bookingData.bookingDate} has been completed. We hope you had a wonderful time!`;
            break;
          default:
            notificationTitle = 'Booking Status Updated';
            notificationMessage = `Your booking for ${bookingData.eventType} on ${bookingData.bookingDate} status has been updated to ${status}.`;
        }

        const notificationData = {
          type: `booking_${status}`,
          title: notificationTitle,
          message: notificationMessage,
          data: {
            bookingId: id,
            eventType: bookingData.eventType,
            bookingDate: bookingData.bookingDate,
            startTime: bookingData.startTime,
            endTime: bookingData.endTime,
            status: status,
            hallName: bookingData.hallName,
            calculatedPrice: bookingData.calculatedPrice
          }
        };

        await createNotificationAndSendEmail(bookingData.customerId, bookingData.customerEmail, notificationData);
        console.log('Notification and email sent for customer status update:', bookingData.customerId);
      } catch (notificationError) {
        console.error('Error creating notification:', notificationError);
        // Don't fail the booking update if notification creation fails
      }
    }

    res.json({
      message: 'Booking status updated successfully',
      bookingId: id,
      newStatus: status
    });

  } catch (error) {
    console.error('Error updating booking status:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/bookings/:id/price - Update booking price (hall owner only)
router.put('/:id/price', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { calculatedPrice, priceDetails, notes } = req.body;
    const userId = req.user.uid;

    // Validate price
    if (calculatedPrice !== undefined && (typeof calculatedPrice !== 'number' || calculatedPrice < 0)) {
      return res.status(400).json({
        message: 'Calculated price must be a non-negative number'
      });
    }

    // Get booking
    const bookingDoc = await admin.firestore().collection('bookings').doc(id).get();
    if (!bookingDoc.exists) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const bookingData = bookingDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = bookingData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      // For sub_users, verify they belong to the same hall owner
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      // Verify the sub_user is trying to update their parent's booking
      if (actualHallOwnerId !== bookingData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only update your parent hall owner\'s bookings.' });
      }
    } else if (userData.role === 'hall_owner') {
      // For hall_owners, verify they are updating their own booking
      if (bookingData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only update your own bookings.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can update booking prices.' });
    }

    // Prepare update data
    const updateData = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (calculatedPrice !== undefined) updateData.calculatedPrice = calculatedPrice;
    if (priceDetails !== undefined) updateData.priceDetails = priceDetails;
    if (notes !== undefined) updateData.priceNotes = notes;

    // Update booking price
    await admin.firestore().collection('bookings').doc(id).update(updateData);

    // Log booking price update in audit
    try {
      const AuditService = require('../services/auditService');
      const userEmail = (req.user && (req.user.email || req.user.user_email)) || '';
      const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];
      await AuditService.logBookingUpdated(
        userId,
        userEmail,
        userData.role,
        { id, ...bookingData },
        { id, ...bookingData, ...updateData },
        ipAddress,
        actualHallOwnerId
      );
    } catch (auditErr) {
      console.error('Audit log for price update failed (non-blocking):', auditErr.message);
    }

    // Create notification and send email for the customer if they have a customerId and price was updated
    if (bookingData.customerId && bookingData.customerEmail && calculatedPrice !== undefined) {
      try {
        const notificationData = {
          type: 'booking_price_updated',
          title: 'Booking Price Updated',
          message: `The price for your ${bookingData.eventType} booking on ${bookingData.bookingDate} has been updated to $${calculatedPrice.toFixed(2)}. Please review the updated pricing details.`,
          data: {
            bookingId: id,
            eventType: bookingData.eventType,
            bookingDate: bookingData.bookingDate,
            startTime: bookingData.startTime,
            endTime: bookingData.endTime,
            calculatedPrice: calculatedPrice,
            previousPrice: bookingData.calculatedPrice,
            hallName: bookingData.hallName
          }
        };

        await createNotificationAndSendEmail(bookingData.customerId, bookingData.customerEmail, notificationData);
        console.log('Price update notification and email sent for customer:', bookingData.customerId);
      } catch (notificationError) {
        console.error('Error creating price update notification:', notificationError);
        // Don't fail the price update if notification creation fails
      }
    }

    res.json({
      message: 'Booking price updated successfully',
      bookingId: id,
      updatedPrice: calculatedPrice
    });

  } catch (error) {
    console.error('Error updating booking price:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/bookings/:id - Get a specific booking (hall owner only)
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid;

    // Get booking
    const bookingDoc = await admin.firestore().collection('bookings').doc(id).get();
    if (!bookingDoc.exists) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const bookingData = bookingDoc.data();
    
    // Get user data to verify they are a hall_owner or sub_user
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }

    const userData = userDoc.data();
    
    // Determine the actual hall owner ID
    let actualHallOwnerId = bookingData.hallOwnerId;
    
    if (userData.role === 'sub_user') {
      // For sub_users, verify they belong to the same hall owner
      if (!userData.parentUserId) {
        return res.status(403).json({ message: 'Access denied. Sub-user has no parent hall owner.' });
      }
      actualHallOwnerId = userData.parentUserId;
      
      // Verify the sub_user is trying to view their parent's booking
      if (actualHallOwnerId !== bookingData.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only view your parent hall owner\'s bookings.' });
      }
    } else if (userData.role === 'hall_owner') {
      // For hall_owners, verify they are viewing their own booking
      if (bookingData.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only view your own bookings.' });
      }
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can view bookings.' });
    }

    res.json({
      id: bookingDoc.id,
      ...bookingData,
      createdAt: bookingData.createdAt?.toDate?.() || null,
      updatedAt: bookingData.updatedAt?.toDate?.() || null
    });

  } catch (error) {
    console.error('Error fetching booking:', error);
    res.status(500).json({ message: error.message });
  }
});

// PUT /api/bookings/:id - Update booking core fields (hall owner or sub-user)
router.put('/:id', verifyToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid || req.user.user_id;
    const {
      customerName,
      customerEmail,
      customerPhone,
      eventType,
      selectedHall,
      bookingDate,
      startTime,
      endTime,
      additionalDescription,
      guestCount,
      status,
      estimatedPrice
    } = req.body;

    // Get existing booking
    const bookingRef = admin.firestore().collection('bookings').doc(id);
    const bookingSnap = await bookingRef.get();
    if (!bookingSnap.exists) {
      return res.status(404).json({ message: 'Booking not found' });
    }
    const existing = bookingSnap.data();

    // Permission: hall_owner or sub_user tied to same hallOwnerId
    const userDoc = await admin.firestore().collection('users').doc(userId).get();
    if (!userDoc.exists) {
      return res.status(404).json({ message: 'User not found' });
    }
    const userData = userDoc.data();

    let permittedHallOwnerId = null;
    if (userData.role === 'hall_owner') {
      if (existing.hallOwnerId !== userId) {
        return res.status(403).json({ message: 'Access denied. You can only update your own bookings.' });
      }
      permittedHallOwnerId = userId;
    } else if (userData.role === 'sub_user') {
      if (!userData.parentUserId || userData.parentUserId !== existing.hallOwnerId) {
        return res.status(403).json({ message: 'Access denied. You can only update your parent hall owner\'s bookings.' });
      }
      permittedHallOwnerId = userData.parentUserId;
    } else {
      return res.status(403).json({ message: 'Access denied. Only hall owners and sub-users can update bookings.' });
    }

    const updateData = {};

    // Validate and apply fields if present
    if (customerName !== undefined) updateData.customerName = String(customerName).trim();
    if (customerEmail !== undefined) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(customerEmail)) return res.status(400).json({ message: 'Invalid email format' });
      updateData.customerEmail = customerEmail.trim().toLowerCase();
    }
    if (customerPhone !== undefined) {
      const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
      if (!phoneRegex.test(String(customerPhone).replace(/[\s\-\(\)]/g, ''))) return res.status(400).json({ message: 'Invalid phone number format' });
      updateData.customerPhone = String(customerPhone).trim();
    }
    if (eventType !== undefined) updateData.eventType = String(eventType).trim();
    if (additionalDescription !== undefined) updateData.additionalDescription = String(additionalDescription || '').trim();
    if (guestCount !== undefined) updateData.guestCount = guestCount ? parseInt(guestCount) : null;
    if (status !== undefined) {
      if (!['pending', 'confirmed', 'cancelled', 'completed'].includes(status)) {
        return res.status(400).json({ message: 'Invalid status value' });
      }
      updateData.status = status;
    }

    let hallNameToSet = null;
    const newSelectedHall = selectedHall !== undefined ? selectedHall : existing.selectedHall;
    const newBookingDate = bookingDate !== undefined ? bookingDate : existing.bookingDate;
    const newStartTime = startTime !== undefined ? startTime : existing.startTime;
    const newEndTime = endTime !== undefined ? endTime : existing.endTime;

    // If any date/time/resource changed, validate and conflict-check
    const coreChanged = selectedHall !== undefined || bookingDate !== undefined || startTime !== undefined || endTime !== undefined;
    if (coreChanged) {
      // Validate date/time
      const dateObj = new Date(newBookingDate);
      if (isNaN(dateObj.getTime())) return res.status(400).json({ message: 'Invalid booking date format' });
      const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(newStartTime) || !timeRegex.test(newEndTime)) return res.status(400).json({ message: 'Invalid time format' });
      const st = new Date(`2000-01-01T${newStartTime}:00`);
      const et = new Date(`2000-01-01T${newEndTime}:00`);
      if (et <= st) return res.status(400).json({ message: 'End time must be after start time' });

      // Verify hall exists and belongs to hall owner
      const hallDoc = await admin.firestore().collection('resources').doc(newSelectedHall).get();
      if (!hallDoc.exists) return res.status(404).json({ message: 'Selected hall not found' });
      const hallData = hallDoc.data();
      if (hallData.hallOwnerId !== permittedHallOwnerId) return res.status(400).json({ message: 'Selected hall does not belong to hall owner' });
      hallNameToSet = hallData.name;

      // Conflict check (exclude current booking)
      const conflictsSnap = await admin.firestore()
        .collection('bookings')
        .where('hallOwnerId', '==', permittedHallOwnerId)
        .where('selectedHall', '==', newSelectedHall)
        .where('bookingDate', '==', newBookingDate)
        .where('status', 'in', ['pending', 'confirmed'])
        .get();

      for (const d of conflictsSnap.docs) {
        if (d.id === id) continue;
        const b = d.data();
        const es = new Date(`2000-01-01T${b.startTime}:00`);
        const ee = new Date(`2000-01-01T${b.endTime}:00`);
        if (st < ee && et > es) {
          return res.status(409).json({ message: 'Time slot is already booked. Please choose a different time.' });
        }
      }

      updateData.selectedHall = newSelectedHall;
      updateData.hallName = hallNameToSet;
      updateData.bookingDate = newBookingDate;
      updateData.startTime = newStartTime;
      updateData.endTime = newEndTime;
    }

    // Optionally recalc price when core changed
    if (coreChanged) {
      try {
        let calculatedPrice = existing.calculatedPrice || 0;
        let priceDetails = existing.priceDetails || null;

        const pricingSnapshot = await admin.firestore()
          .collection('pricing')
          .where('hallOwnerId', '==', permittedHallOwnerId)
          .where('resourceId', '==', newSelectedHall)
          .get();
        if (!pricingSnapshot.empty) {
          const pricingData = pricingSnapshot.docs[0].data();
          const stObj = new Date(`${newBookingDate}T${newStartTime}:00`);
          const etObj = new Date(`${newBookingDate}T${newEndTime}:00`);
          const hours = (etObj.getTime() - stObj.getTime()) / (1000 * 60 * 60);
          const isWeekend = new Date(newBookingDate).getDay() === 0 || new Date(newBookingDate).getDay() === 6;
          const rate = isWeekend ? pricingData.weekendRate : pricingData.weekdayRate;
          calculatedPrice = pricingData.rateType === 'hourly' ? rate * hours : (hours >= 8 ? rate : rate * 0.5);
          priceDetails = {
            rateType: pricingData.rateType,
            weekdayRate: pricingData.weekdayRate,
            weekendRate: pricingData.weekendRate,
            appliedRate: rate,
            durationHours: hours,
            isWeekend: isWeekend,
            calculationMethod: pricingData.rateType === 'hourly' ? 'hourly' : 'daily',
            frontendEstimatedPrice: estimatedPrice || null
          };
        } else if (estimatedPrice !== undefined) {
          calculatedPrice = estimatedPrice || 0;
        }

        updateData.calculatedPrice = calculatedPrice;
        updateData.priceDetails = priceDetails;
      } catch (priceErr) {
        console.error('Price recalculation failed (non-blocking):', priceErr.message);
        if (estimatedPrice !== undefined) updateData.calculatedPrice = estimatedPrice || 0;
      }
    }

    updateData.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await bookingRef.update(updateData);

    const updatedSnap = await bookingRef.get();
    const updated = updatedSnap.data();

    res.json({
      message: 'Booking updated successfully',
      booking: {
        id,
        ...updated,
        createdAt: updated.createdAt?.toDate?.() || null,
        updatedAt: updated.updatedAt?.toDate?.() || null
      }
    });

  } catch (error) {
    console.error('Error updating booking:', error);
    res.status(500).json({ message: error.message });
  }
});

// GET /api/bookings/unavailable-dates/:hallOwnerId - Get unavailable dates for calendar (public endpoint)
router.get('/unavailable-dates/:hallOwnerId', async (req, res) => {
  try {
    const { hallOwnerId } = req.params;
    const { resourceId, startDate, endDate } = req.query;
    
    console.log('Fetching unavailable dates for hallOwnerId:', hallOwnerId);
    console.log('Query params:', { resourceId, startDate, endDate });
    
    // Validate hall owner exists
    const userDoc = await admin.firestore().collection('users').doc(hallOwnerId).get();
    if (!userDoc.exists) {
      console.log('Hall owner not found:', hallOwnerId);
      return res.status(404).json({ message: 'Hall owner not found' });
    }

    const userData = userDoc.data();
    if (userData.role !== 'hall_owner') {
      console.log('User is not a hall owner:', userData.role);
      return res.status(404).json({ message: 'Hall owner not found' });
    }

    console.log('Hall owner validated:', userData.name || userData.businessName);

    // Get all bookings for this hall owner first, then filter in memory
    // This avoids complex Firestore query issues
    let query = admin.firestore()
      .collection('bookings')
      .where('hallOwnerId', '==', hallOwnerId);

    console.log('Executing Firestore query...');
    const bookingsSnapshot = await query.get();
    console.log('Found', bookingsSnapshot.docs.length, 'total bookings');
    
    // Filter bookings in memory
    const filteredBookings = bookingsSnapshot.docs.filter(doc => {
      const booking = doc.data();
      
      // Filter by status
      if (!['pending', 'confirmed'].includes(booking.status)) {
        return false;
      }
      
      // Filter by resource if specified
      if (resourceId && booking.selectedHall !== resourceId) {
        return false;
      }
      
      // Filter by date range if specified
      if (startDate && booking.bookingDate < startDate) {
        return false;
      }
      if (endDate && booking.bookingDate > endDate) {
        return false;
      }
      
      return true;
    });
    
    console.log('Filtered to', filteredBookings.length, 'active bookings');
    
    // Group bookings by date and resource
    const unavailableDates = {};
    
    filteredBookings.forEach(doc => {
      const booking = doc.data();
      const bookingDate = booking.bookingDate;
      const selectedHall = booking.selectedHall;
      
      if (!bookingDate || !selectedHall) {
        console.log('Skipping booking with missing data:', booking);
        return;
      }
      
      if (!unavailableDates[bookingDate]) {
        unavailableDates[bookingDate] = {};
      }
      
      if (!unavailableDates[bookingDate][selectedHall]) {
        unavailableDates[bookingDate][selectedHall] = [];
      }
      
      unavailableDates[bookingDate][selectedHall].push({
        bookingId: doc.id,
        startTime: booking.startTime || 'N/A',
        endTime: booking.endTime || 'N/A',
        customerName: booking.customerName || 'Unknown',
        eventType: booking.eventType || 'Unknown',
        status: booking.status || 'Unknown'
      });
    });

    console.log('Processed unavailable dates:', Object.keys(unavailableDates));

    res.json({
      unavailableDates,
      totalBookings: filteredBookings.length,
      message: 'Successfully fetched unavailable dates'
    });

  } catch (error) {
    console.error('Error fetching unavailable dates:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      message: 'Internal server error while fetching unavailable dates',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// GET /api/bookings/test - Simple test endpoint
router.get('/test', (req, res) => {
  res.json({ 
    message: 'Bookings API is working!',
    timestamp: new Date().toISOString(),
    status: 'OK'
  });
});

// Test route for email functionality
router.post('/test-email', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ message: 'Email address is required' });
    }

    await emailService.sendTestEmail(email);
    
    res.json({
      message: 'Test email sent successfully',
      recipient: email
    });
  } catch (error) {
    console.error('Test email error:', error);
    res.status(500).json({ 
      message: 'Failed to send test email',
      error: error.message 
    });
  }
});

module.exports = router;
