# Email Notifications Feature

## Overview
This feature automatically sends email notifications to users when certain events occur in the booking management system. It integrates with the existing notification system and sends beautifully formatted HTML emails.

## Features
- ✅ Automatic email sending when notifications are created
- ✅ Professional HTML email templates
- ✅ Responsive design that works on all devices
- ✅ Booking details included in emails
- ✅ Action buttons for user engagement
- ✅ Cranbourne Public Hall branding
- ✅ Multiple notification types supported

## Supported Notification Types

### 1. Booking Submission (`booking_submitted`)
- Triggered when a customer submits a booking request
- Includes estimated pricing if available
- Action button: "View Booking Status"

### 2. Booking Confirmation (`booking_confirmed`)
- Triggered when a booking is confirmed by hall staff
- Celebratory messaging and confirmation details
- Action button: "View Booking Details"

### 3. Booking Cancellation (`booking_cancelled`)
- Triggered when a booking is cancelled
- Apologetic messaging with contact information
- Action button: "Book Again"

### 4. Booking Price Update (`booking_price_updated`)
- Triggered when booking pricing is updated
- Shows old and new prices
- Action button: "View Updated Price"

### 5. Event Completion (`booking_completed`)
- Triggered when an event is marked as completed
- Thank you message and feedback request
- Action button: "View Booking Details"

## Configuration

### Email Settings
The email service is configured in `services/emailService.js`:

```javascript
const transporter = nodemailer.createTransporter({
  service: 'gmail',
  auth: {
    user: 'pawankanchana34741@gmail.com',
    pass: 'ijzu oxwl nuok hdxv' // App-specific password
  }
});
```

### Gmail App Password Setup
1. Enable 2-factor authentication on your Gmail account
2. Generate an app-specific password:
   - Go to Google Account settings
   - Security → 2-Step Verification → App passwords
   - Generate password for "Mail"
   - Use the generated password in the configuration

## Usage

### Automatic Email Sending
Emails are automatically sent when notifications are created through the booking system:

```javascript
// When creating a booking
await createNotificationAndSendEmail(customerId, customerEmail, {
  type: 'booking_submitted',
  title: 'Booking Request Submitted',
  message: 'Your booking has been submitted...',
  data: { /* booking details */ }
});
```

### Manual Email Testing
Use the test endpoint to send test emails:

```bash
POST /api/bookings/test-email
Content-Type: application/json

{
  "email": "recipient@example.com"
}
```

### Running Email Tests
Test the email functionality with the provided test script:

```bash
npm run test-email
```

This will send test emails for all notification types to verify the system is working.

## Email Template Features

### Professional Design
- Clean, modern HTML layout
- Cranbourne Public Hall branding
- Responsive design for mobile and desktop
- Professional color scheme

### Booking Information
- Booking ID and details
- Event type and date/time
- Pricing information
- Hall name and location

### Action Buttons
- Context-aware action buttons
- Direct links to relevant pages
- Clear call-to-action messaging

### Footer Information
- System identification
- Automated notification disclaimer
- Professional closing

## Integration Points

### Booking Creation
When a booking is created via `POST /api/bookings`, an email is sent if:
- `customerId` is provided
- `customerEmail` is provided

### Booking Status Updates
When booking status is updated via `PUT /api/bookings/:id/status`, an email is sent for:
- Confirmation
- Cancellation
- Completion
- Any other status changes

### Price Updates
When booking price is updated via `PUT /api/bookings/:id/price`, an email is sent if:
- Price actually changed
- Customer email is available

## Error Handling

### Graceful Degradation
- Email failures don't prevent notification creation
- System continues to work even if email service is down
- Detailed error logging for troubleshooting

### Logging
All email operations are logged with appropriate success/error messages:
```
✅ Email sent successfully: <message-id>
❌ Failed to send email to: user@example.com <error-details>
```

## Security Considerations

### App Passwords
- Uses Gmail app-specific passwords (not main password)
- Passwords are stored in code (consider environment variables for production)

### Email Validation
- Recipient email addresses should be validated
- Consider rate limiting for email sending

## Future Enhancements

### Potential Improvements
1. **Environment Variables**: Move email credentials to environment variables
2. **Email Templates**: Make templates configurable
3. **Multiple Providers**: Support for other email providers (SendGrid, AWS SES)
4. **Email Preferences**: Allow users to opt-out of certain email types
5. **Email Analytics**: Track email open rates and click-through rates
6. **Scheduled Emails**: Send reminder emails before events
7. **Email Queuing**: Handle high volume email sending

### Configuration Options
1. **SMTP Settings**: Configurable SMTP server settings
2. **Template Customization**: Customizable email templates
3. **Branding**: Configurable logos and colors
4. **Sender Information**: Configurable sender name and reply-to address

## Troubleshooting

### Common Issues

#### 1. Authentication Failed
```
Error: Invalid login: 535-5.7.8 Username and Password not accepted
```
**Solution**: Verify app password is correct and 2FA is enabled

#### 2. Connection Timeout
```
Error: Connection timeout
```
**Solution**: Check internet connection and firewall settings

#### 3. Email Not Received
- Check spam/junk folder
- Verify recipient email address is correct
- Check email service logs for errors

### Testing
Use the test script to verify email functionality:
```bash
npm run test-email
```

Check the console output for success/error messages and verify emails are received.

## Dependencies

- `nodemailer`: ^7.0.6 - Email sending library
- `firebase-admin`: ^13.5.0 - For notification storage
- `express`: ^5.1.0 - Web framework

## Files Modified/Created

### New Files
- `services/emailService.js` - Main email service
- `test-email-notifications.js` - Email testing script
- `EMAIL_NOTIFICATIONS_README.md` - This documentation

### Modified Files
- `routes/bookings.js` - Integrated email sending with notifications
- `package.json` - Added test script

## Support

For issues or questions regarding the email notification system:
1. Check the console logs for error messages
2. Run the test script to verify email functionality
3. Verify Gmail app password configuration
4. Check recipient email address validity
