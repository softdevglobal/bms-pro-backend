# Email Communications Feature

This document describes the comprehensive email communications system implemented for the BMS (Booking Management System) application.

## Overview

The email communications feature allows hall owners and administrators to:
- Create and manage reusable email templates with personalization variables
- Send customized emails to customers using templates or custom content
- Track email history and delivery status
- Integrate with booking data for contextual communication

## Features

### 1. Email Templates Management
- **Create Templates**: Design reusable email templates with personalization variables
- **Edit Templates**: Update existing templates with a rich editor
- **Delete Templates**: Remove unused templates
- **Template Preview**: Preview templates with sample data
- **Variable Support**: Use placeholders like `{{customerName}}`, `{{bookingDate}}`, etc.

### 2. Email Sending
- **Template-based Emails**: Send emails using pre-designed templates
- **Custom Emails**: Send one-off emails without templates
- **Customer Selection**: Choose recipients from customer database
- **Booking Integration**: Link emails to specific bookings for context
- **Real-time Preview**: See how the email will look before sending

### 3. Email History & Tracking
- **Send History**: View all sent emails with status and timestamps
- **Status Tracking**: Monitor email delivery status (sent, failed, pending)
- **Search & Filter**: Find specific emails by recipient, subject, or status
- **Email Details**: View full email content and metadata

## API Endpoints

### Email Templates (`/api/email-templates`)

#### GET `/api/email-templates`
- **Description**: Get all email templates for a hall owner
- **Query Parameters**:
  - `limit` (optional): Number of templates to return (default: 50)
  - `offset` (optional): Number of templates to skip (default: 0)
- **Response**: List of templates with metadata

#### GET `/api/email-templates/:id`
- **Description**: Get a specific email template
- **Parameters**: `id` - Template ID
- **Response**: Template details

#### POST `/api/email-templates`
- **Description**: Create a new email template
- **Body**:
  ```json
  {
    "name": "Template Name",
    "type": "email",
    "subject": "Email Subject with {{variables}}",
    "body": "Email body with {{personalization}}",
    "variables": ["customerName", "bookingDate"]
  }
  ```

#### PUT `/api/email-templates/:id`
- **Description**: Update an existing template
- **Parameters**: `id` - Template ID
- **Body**: Same as POST

#### DELETE `/api/email-templates/:id`
- **Description**: Delete a template
- **Parameters**: `id` - Template ID

### Email Communications (`/api/email-comms`)

#### POST `/api/email-comms/send`
- **Description**: Send a customized email
- **Body**:
  ```json
  {
    "templateId": "template_id_optional",
    "recipientEmail": "customer@example.com",
    "recipientName": "Customer Name",
    "bookingId": "booking_id_optional",
    "customSubject": "Custom subject if not using template",
    "customBody": "Custom body if not using template",
    "variables": {
      "customerName": "John Doe",
      "bookingDate": "2024-01-15"
    }
  }
  ```

#### GET `/api/email-comms/history`
- **Description**: Get email history
- **Query Parameters**:
  - `limit` (optional): Number of emails to return
  - `offset` (optional): Number of emails to skip
  - `status` (optional): Filter by status (sent, failed, pending)
  - `recipientEmail` (optional): Filter by recipient

#### GET `/api/email-comms/customers`
- **Description**: Get customers for email sending
- **Query Parameters**:
  - `search` (optional): Search customers by name or email

#### GET `/api/email-comms/bookings/:customerEmail`
- **Description**: Get bookings for a specific customer
- **Parameters**: `customerEmail` - Customer's email address

## Available Template Variables

The following variables can be used in email templates:

| Variable | Description | Example |
|----------|-------------|---------|
| `{{customerName}}` | Customer's full name | "John Doe" |
| `{{customerEmail}}` | Customer's email address | "john@example.com" |
| `{{bookingId}}` | Unique booking identifier | "BK-2024-001" |
| `{{eventType}}` | Type of event | "Wedding Reception" |
| `{{bookingDate}}` | Date of the booking | "2024-01-15" |
| `{{startTime}}` | Start time | "6:00 PM" |
| `{{endTime}}` | End time | "11:00 PM" |
| `{{hallName}}` | Venue name | "Main Hall" |
| `{{calculatedPrice}}` | Booking price | "$500.00" |
| `{{guestCount}}` | Number of guests | "50" |
| `{{status}}` | Booking status | "confirmed" |

## Frontend Components

### 1. CommsTemplates Page
- Template management interface
- Rich template editor with variable insertion
- Template preview functionality
- CRUD operations for templates

### 2. CommsSendEmail Page
- Customer selection interface
- Booking integration
- Template selection or custom content
- Real-time email preview
- Send email functionality

### 3. CommsMessages Page
- Email history viewer
- Search and filter capabilities
- Email detail modal
- Quick email sending form

## Database Schema

### Email Templates Collection (`emailTemplates`)
```javascript
{
  id: "template_id",
  hallOwnerId: "hall_owner_id",
  name: "Template Name",
  type: "email", // or "sms"
  subject: "Email Subject",
  body: "Email Body",
  variables: ["customerName", "bookingDate"],
  isActive: true,
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### Email History Collection (`emailHistory`)
```javascript
{
  id: "email_id",
  hallOwnerId: "hall_owner_id",
  to: "recipient@example.com",
  recipientName: "Recipient Name",
  subject: "Email Subject",
  body: "Email Body",
  templateId: "template_id_optional",
  templateName: "Template Name",
  bookingId: "booking_id_optional",
  status: "sent", // or "failed", "pending"
  sentBy: "user_id",
  sentAt: timestamp,
  messageId: "email_message_id"
}
```

## Testing

Run the test script to verify functionality:

```bash
cd bmspro-backend
node test-email-comms.js
```

The test script will:
1. Authenticate a user
2. Create an email template
3. Send emails using templates and custom content
4. Verify email history tracking
5. Test template CRUD operations

## Security Considerations

- All API endpoints require authentication
- Users can only access their own templates and email history
- Email sending is rate-limited to prevent abuse
- Sensitive customer data is properly handled

## Future Enhancements

- Email scheduling functionality
- Email analytics and open/click tracking
- SMS integration alongside email
- Advanced template editor with WYSIWYG support
- Email campaign management
- Automated email triggers based on booking events

## Troubleshooting

### Common Issues

1. **Email not sending**: Check SMTP configuration in `emailService.js`
2. **Template variables not working**: Ensure variables are properly formatted with `{{variableName}}`
3. **Authentication errors**: Verify JWT token is valid and not expired
4. **Customer data not loading**: Check if customer has existing bookings

### Debug Mode

Enable debug logging by setting `NODE_ENV=development` in your environment variables.

## Support

For technical support or feature requests, please contact the development team or create an issue in the project repository.
