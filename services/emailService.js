const nodemailer = require('nodemailer');
const admin = require('../firebaseAdmin');

//email service
class EmailService {
  constructor() {
    console.log('📧 EmailService: Initializing email service...');
    
    // Configure nodemailer with Gmail SMTP
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'dpawan434741@gmail.com',
        pass: 'tmoltlllrsvpflkm' // App-specific password (spaces removed)
      }
    });

    console.log('📧 EmailService: Transporter created, verifying connection...');
    // Verify transporter configuration
    this.verifyConnection();
  }

  // Fetch hall owner's logo from Firebase Storage
  async getHallOwnerLogo(hallOwnerId) {
    try {
      if (!hallOwnerId) {
        return 'https://via.placeholder.com/200x80/4F46E5/FFFFFF?text=Cranbourne+Hall';
      }

      const userDoc = await admin.firestore().collection('users').doc(hallOwnerId).get();
      if (!userDoc.exists) {
        return 'https://via.placeholder.com/200x80/4F46E5/FFFFFF?text=Cranbourne+Hall';
      }

      const userData = userDoc.data();
      return userData.profilePicture || 'https://via.placeholder.com/200x80/4F46E5/FFFFFF?text=Cranbourne+Hall';
    } catch (error) {
      console.error('Error fetching hall owner logo:', error);
      return 'https://via.placeholder.com/200x80/4F46E5/FFFFFF?text=Cranbourne+Hall';
    }
  }

  // Fetch hall owner's accepted payment methods with sensible defaults
  async getHallOwnerPaymentMethods(hallOwnerId) {
    try {
      if (!hallOwnerId) {
        return { bankTransfer: true, cash: true, cheque: false };
      }
      const userDoc = await admin.firestore().collection('users').doc(hallOwnerId).get();
      if (!userDoc.exists) {
        return { bankTransfer: true, cash: true, cheque: false };
      }
      const data = userDoc.data() || {};
      const saved = data.paymentMethods || {};
      const defaults = { bankTransfer: true, cash: true, cheque: false };
      return { ...defaults, ...saved };
    } catch (error) {
      console.warn('Error fetching hall owner payment methods:', error?.message || error);
      return { bankTransfer: true, cash: true, cheque: false };
    }
  }

  // Fetch hall owner's bank transfer details if configured
  async getHallOwnerBankDetails(hallOwnerId) {
    try {
      if (!hallOwnerId) return null;
      const userDoc = await admin.firestore().collection('users').doc(hallOwnerId).get();
      if (!userDoc.exists) return null;
      const data = userDoc.data() || {};
      return data.bankDetails || null;
    } catch (error) {
      console.warn('Error fetching hall owner bank details:', error?.message || error);
      return null;
    }
  }

  // Safely normalize Firestore Timestamp, Date, ISO string, or epoch to Date
  normalizeDate(dateLike) {
    try {
      if (!dateLike) return null;
      if (dateLike instanceof Date) return isNaN(dateLike.getTime()) ? null : dateLike;
      if (typeof dateLike?.toDate === 'function') {
        const d = dateLike.toDate();
        return isNaN(d?.getTime?.()) ? null : d;
      }
      if (typeof dateLike === 'number') {
        const d = new Date(dateLike);
        return isNaN(d.getTime()) ? null : d;
      }
      if (typeof dateLike === 'string') {
        const d = new Date(dateLike);
        return isNaN(d.getTime()) ? null : d;
      }
      if (typeof dateLike === 'object' && dateLike._seconds) {
        const d = new Date(dateLike._seconds * 1000);
        return isNaN(d.getTime()) ? null : d;
      }
      const d = new Date(dateLike);
      return isNaN(d.getTime()) ? null : d;
    } catch (_) {
      return null;
    }
  }

  // Format any date-like value to en-AU date or 'N/A'
  formatDateAU(dateLike) {
    const d = this.normalizeDate(dateLike);
    return d ? d.toLocaleDateString('en-AU') : 'N/A';
  }

  async verifyConnection() {
    try {
      console.log('📧 EmailService: Verifying connection...');
      await this.transporter.verify();
      console.log('✅ EmailService: Email service connected successfully');
    } catch (error) {
      console.error('❌ EmailService: Email service connection failed:', error);
    }
  }

  async sendNotificationEmail(notificationData, userEmail, hallOwnerId = null) {
    try {
      console.log('📧 EmailService: Preparing to send notification email...');
      console.log('📧 EmailService: Recipient:', userEmail);
      console.log('📧 EmailService: Notification type:', notificationData.type);
      
      const { type, title, message, data } = notificationData;
      
      // Generate email content based on notification type
      const emailContent = await this.generateEmailContent(type, title, message, data, hallOwnerId);
      
      const mailOptions = {
        from: 'dpawan434741@gmail.com',
        to: userEmail,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text
      };

      console.log('📧 EmailService: Sending email with subject:', emailContent.subject);
      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ EmailService: Email sent successfully:', result.messageId);
      return result;
    } catch (error) {
      console.error('❌ EmailService: Failed to send email:', error);
      throw error;
    }
  }

  async generateEmailContent(type, title, message, data, hallOwnerId = null) {
    const baseTemplate = {
      subject: `Cranbourne Public Hall - ${title}`,
      text: message,
      html: await this.generateHTMLTemplate(type, title, message, data, hallOwnerId)
    };

    return baseTemplate;
  }

  async generateHTMLTemplate(type, title, message, data, hallOwnerId = null) {
    // Fetch company logo from database
    const logoUrl = await this.getHallOwnerLogo(hallOwnerId);
    
    let actionButton = '';
    let bookingDetails = '';
    let paymentBreakdown = '';
    let paymentInformation = '';
    
    // Add booking details if available
    if (data && data.bookingId) {
      // Calculate payment details
      const subtotal = Number(data.calculatedPrice || 0);
      const gstRate = 0.10; // 10% GST
      const gstAmount = Math.round(subtotal * gstRate * 100) / 100;
      const totalWithGST = Math.round((subtotal + gstAmount) * 100) / 100;
      const depositAmount = Number(data.depositAmount || 0);
      const balanceDue = Math.max(0, Math.round((totalWithGST - depositAmount) * 100) / 100);

      bookingDetails = `
        <div style="background-color: #f0f9ff; border: 2px solid #0ea5e9; border-radius: 12px; padding: 25px; margin: 25px 0;">
          <h3 style="color: #0c4a6e; margin: 0 0 20px 0; font-size: 20px; border-bottom: 2px solid #0ea5e9; padding-bottom: 10px;">
            📋 Booking Details
          </h3>
          <table style="width: 100%; border-collapse: collapse;">
            ${data.bookingCode ? `
            <tr style="background-color: #fef3c7; border: 2px solid #f59e0b;">
              <td style="padding: 15px 12px; color: #92400e; font-weight: bold; font-size: 18px;">🎫 Booking Reference:</td>
              <td style="padding: 15px 12px; color: #92400e; font-weight: bold; font-size: 18px; font-family: monospace; text-align: right;">${data.bookingCode}</td>
            </tr>
            ` : ''}
            ${data.customerName ? `
            <tr>
              <td style="padding: 12px 8px; color: #64748b; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Customer Name:</td>
              <td style="padding: 12px 8px; color: #1e293b; border-bottom: 1px solid #e2e8f0; text-align: right;">${data.customerName}</td>
            </tr>
            ` : ''}
            ${data.eventType ? `
            <tr>
              <td style="padding: 12px 8px; color: #64748b; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Event Type:</td>
              <td style="padding: 12px 8px; color: #1e293b; border-bottom: 1px solid #e2e8f0; text-align: right;">${data.eventType}</td>
            </tr>
            ` : ''}
            ${data.hallName ? `
            <tr>
              <td style="padding: 12px 8px; color: #64748b; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Venue:</td>
              <td style="padding: 12px 8px; color: #1e293b; border-bottom: 1px solid #e2e8f0; text-align: right;">${data.hallName}</td>
            </tr>
            ` : ''}
            ${data.bookingDate ? `
            <tr>
              <td style="padding: 12px 8px; color: #64748b; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Date:</td>
              <td style="padding: 12px 8px; color: #1e293b; border-bottom: 1px solid #e2e8f0; text-align: right;">${data.bookingDate}</td>
            </tr>
            ` : ''}
            ${data.startTime ? `
            <tr>
              <td style="padding: 12px 8px; color: #64748b; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Time:</td>
              <td style="padding: 12px 8px; color: #1e293b; border-bottom: 1px solid #e2e8f0; text-align: right;">${data.startTime}${data.endTime ? ` - ${data.endTime}` : ''}</td>
            </tr>
            ` : ''}
            
            ${data.calculatedPrice ? `
            <tr style="background-color: #dcfce7; border-top: 2px solid #22c55e;">
              <td style="padding: 15px 12px; color: #166534; font-weight: bold; font-size: 18px;">💰 Estimated Price:</td>
              <td style="padding: 15px 12px; color: #166534; font-weight: bold; font-size: 18px; text-align: right;">$${subtotal.toFixed(2)} AUD <span style="font-size: 12px; font-weight: 600; color: #64748b;">+ taxes</span></td>
            </tr>
            ` : ''}
          </table>
          ${data.calculatedPrice ? `
          <div style="margin-top: 15px; padding: 12px; background-color: #fef3c7; border-radius: 8px; border-left: 4px solid #f59e0b;">
            <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.6;">
              ℹ️ This is an estimated price. Final invoice will be sent once the booking is confirmed.
            </p>
          </div>
          ` : ''}
        </div>
      `;
    }

    // Add action button based on notification type
    switch (type) {
      case 'booking_submitted':
        actionButton = `
          <div style="text-align: center; margin: 30px 0;">
            <p style="color: #64748b; margin-bottom: 20px;">We'll review your booking and get back to you soon!</p>
            <a href="https://cranbourne-public-hall.vercel.app/booknow" 
               style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              View Booking Status
            </a>
          </div>
        `;
        break;
      case 'booking_confirmed':
        // Build payment breakdown if payment details provided
        if (data) {
          const totalAmount = Number(data.totalAmount ?? 0);
          const depositAmount = Number(data.depositAmount ?? 0);
          const finalDue = Number(data.finalDue ?? Math.max(0, (totalAmount - depositAmount)));
          const taxAmount = Number(data.taxAmount ?? 0);
          const gstRatePct = Number.isFinite(Number(data.gst)) ? Number(data.gst) : 10;
          const taxType = data.taxType || 'Inclusive';
          const subtotal = Math.max(0, Math.round(((totalAmount || 0) - (taxAmount || 0)) * 100) / 100);

          paymentBreakdown = `
            <div style="background-color: #f8fafc; border-radius: 8px; padding: 25px; margin: 10px 0 25px 0;">
              <h3 style="color: #1e293b; margin: 0 0 16px 0; font-size: 18px; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">💳 Payment Breakdown</h3>
              <table style="width: 100%; border-collapse: collapse;">
                ${totalAmount ? `
                <tr>
                  <td style="padding: 10px 8px; color: #64748b; font-weight: 600;">Subtotal:</td>
                  <td style="padding: 10px 8px; color: #1e293b; text-align: right;">$${subtotal.toFixed(2)} AUD</td>
                </tr>
                <tr>
                  <td style="padding: 10px 8px; color: #64748b; font-weight: 600;">GST (${gstRatePct}%):</td>
                  <td style="padding: 10px 8px; color: #1e293b; text-align: right;">$${taxAmount.toFixed(2)} AUD</td>
                </tr>
                <tr>
                  <td style="padding: 12px 8px; color: #334155; font-weight: 700;">Total (incl. GST):</td>
                  <td style="padding: 12px 8px; color: #059669; font-weight: 800; text-align: right;">$${totalAmount.toFixed(2)} AUD</td>
                </tr>` : ''}
                ${depositAmount ? `
                <tr style="background-color: #dbeafe; border-top: 2px solid #3b82f6; border-bottom: 2px solid #3b82f6;">
                  <td style="padding: 12px 8px; color: #1e40af; font-weight: 800;">💰 Deposit (pay first):</td>
                  <td style="padding: 12px 8px; color: #1e40af; font-weight: 800; text-align: right;">-$${depositAmount.toFixed(2)} AUD</td>
                </tr>` : ''}
                <tr style="background-color: #dcfce7;">
                  <td style="padding: 12px 8px; color: #166534; font-weight: 800;">Final Payment Due:</td>
                  <td style="padding: 12px 8px; color: #166534; font-weight: 800; text-align: right;">$${finalDue.toFixed(2)} AUD</td>
                </tr>
                <tr>
                  <td style="padding: 8px 8px; color: #64748b; font-weight: 600;">Tax Type:</td>
                  <td style="padding: 8px 8px; color: #1e293b; text-align: right;">${taxType}</td>
                </tr>
              </table>
            </div>
          `;
        }
        // Add payment methods and bank details (if configured for the hall owner)
        try {
          const [methods, bank] = await Promise.all([
            this.getHallOwnerPaymentMethods(hallOwnerId),
            this.getHallOwnerBankDetails(hallOwnerId)
          ]);

          const methodsChips = [
            methods?.bankTransfer ? '<span style="display:inline-block;background:#eef2ff;color:#3730a3;padding:6px 10px;border-radius:9999px;font-size:12px;font-weight:600;margin-right:6px;">Bank Transfer</span>' : '',
            methods?.cash ? '<span style="display:inline-block;background:#ecfccb;color:#365314;padding:6px 10px;border-radius:9999px;font-size:12px;font-weight:600;margin-right:6px;">Cash</span>' : '',
            methods?.cheque ? '<span style="display:inline-block;background:#fffbeb;color:#92400e;padding:6px 10px;border-radius:9999px;font-size:12px;font-weight:600;margin-right:6px;">Cheque</span>' : ''
          ].join('');

          const bankHtml = (methods?.bankTransfer && bank)
            ? `
              <div style="background-color:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:16px;margin-top:12px;">
                <div style="color:#9a3412;font-weight:800;margin-bottom:8px;">Bank Transfer Details</div>
                <table style="width:100%;border-collapse:collapse;">
                  ${bank.accountName ? `<tr><td style="padding:6px 0;color:#92400e;font-weight:600;">Account Name:</td><td style="padding:6px 0;color:#7c2d12;text-align:right;">${bank.accountName}</td></tr>` : ''}
                  ${bank.bankName ? `<tr><td style="padding:6px 0;color:#92400e;font-weight:600;">Bank:</td><td style="padding:6px 0;color:#7c2d12;text-align:right;">${bank.bankName}</td></tr>` : ''}
                  ${bank.bsb ? `<tr><td style="padding:6px 0;color:#92400e;font-weight:600;">BSB:</td><td style="padding:6px 0;color:#7c2d12;text-align:right;">${bank.bsb}</td></tr>` : ''}
                  ${bank.accountNumber ? `<tr><td style="padding:6px 0;color:#92400e;font-weight:600;">Account Number:</td><td style="padding:6px 0;color:#7c2d12;text-align:right;">${bank.accountNumber}</td></tr>` : ''}
                </table>
                ${(data?.bookingCode || bank.referenceNote) ? `<div style="margin-top:8px;color:#9a3412;font-size:12px;">Reference: <strong>${bank.referenceNote || 'Please use your booking reference'}</strong>${data?.bookingCode ? ` (<span style="font-family:monospace;">${data.bookingCode}</span>)` : ''}</div>` : ''}
              </div>
            ` : '';

          paymentInformation = `
            <div style="background-color:#f8fafc;border-radius:8px;padding:20px;margin:10px 0 25px 0;border:1px solid #e2e8f0;">
              <h3 style="color:#1e293b;margin:0 0 12px 0;font-size:18px;">Accepted Payment Methods</h3>
              <div>${methodsChips || '<span style="color:#64748b;font-size:14px;">Payment methods will be sent with your invoice.</span>'}</div>
              ${bankHtml}
            </div>
          `;
        } catch (_) {
          // ignore payment info errors
        }
        if (data?.stripePaymentUrl) {
          actionButton = `
            <div style="text-align: center; margin: 30px 0;">
              <p style="color: #059669; margin-bottom: 16px; font-weight: 600;">🎉 Your booking has been confirmed!</p>
              <a href="${data.stripePaymentUrl}" 
                 style="background-color: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                Pay Deposit Securely
              </a>
              <div style="color:#64748b; font-size:12px; margin-top:8px;">This link will take you to our secure payment page.</div>
            </div>
          `;
        } else {
          actionButton = `
            <div style="text-align: center; margin: 30px 0;">
              <p style="color: #059669; margin-bottom: 20px;">🎉 Your booking has been confirmed!</p>
              <a href="https://cranbourne-public-hall.vercel.app/booknow" 
                 style="background-color: #059669; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                View Booking Details
              </a>
            </div>
          `;
        }
        break;
      case 'booking_cancelled':
        actionButton = `
          <div style="text-align: center; margin: 30px 0;">
            <p style="color: #dc2626; margin-bottom: 20px;">We're sorry your booking was cancelled.</p>
            <a href="https://cranbourne-public-hall.vercel.app/booknow" 
               style="background-color: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              Book Again
            </a>
          </div>
        `;
        break;
      case 'booking_price_updated':
        actionButton = `
          <div style="text-align: center; margin: 30px 0;">
            <p style="color: #d97706; margin-bottom: 20px;">Please review the updated pricing.</p>
            <a href="https://cranbourne-public-hall.vercel.app/booknow" 
               style="background-color: #d97706; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              View Updated Price
            </a>
          </div>
        `;
        break;
    }

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Cranbourne Public Hall - ${title}</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f1f5f9;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header (no logo for booking/submission style notifications) -->
          <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 40px 20px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 600;">Cranbourne Public Hall</h1>
          </div>
          
          <!-- Content -->
          <div style="padding: 40px 30px;">
            <h2 style="color: #1e293b; margin: 0 0 20px 0; font-size: 28px; font-weight: 700;">${title}</h2>
            
            <div style="color: #475569; line-height: 1.6; font-size: 16px; margin-bottom: 20px;">
              ${message}
            </div>
            
            ${bookingDetails}
            ${paymentBreakdown}
            ${paymentInformation}
            ${actionButton}
            
            <div style="border-top: 1px solid #e2e8f0; margin-top: 40px; padding-top: 30px; text-align: center;">
              <p style="color: #64748b; font-size: 14px; margin: 0 0 10px 0;">
                Thank you for choosing Cranbourne Public Hall!
              </p>
              <p style="color: #64748b; font-size: 14px; margin: 0;">
                If you have any questions, please don't hesitate to contact us.
              </p>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="color: #64748b; font-size: 12px; margin: 0 0 10px 0;">
              Cranbourne Public Hall Management System
            </p>
            <p style="color: #64748b; font-size: 12px; margin: 0;">
              This is an automated notification. Please do not reply to this email.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  async sendCustomizedEmail(emailData) {
    try {
      console.log('📧 EmailService: Preparing to send customized email...');
      console.log('📧 EmailService: Recipient:', emailData.to);
      console.log('📧 EmailService: Subject:', emailData.subject);
      
      const { to, subject, body, recipientName, bookingId, templateName, isCustom, hallOwnerId } = emailData;
      
      // Generate email content with enhanced template
      const emailContent = await this.generateCustomizedEmailContent({
        subject,
        body,
        recipientName,
        bookingId,
        templateName,
        isCustom,
        hallOwnerId
      });
      
      const mailOptions = {
        from: 'dpawan434741@gmail.com',
        to: to,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
        attachments: Array.isArray(emailData.attachments) ? emailData.attachments : undefined
      };

      console.log('📧 EmailService: Sending customized email...');
      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ EmailService: Customized email sent successfully:', result.messageId);
      return result;
    } catch (error) {
      console.error('❌ EmailService: Failed to send customized email:', error);
      throw error;
    }
  }

  async generateCustomizedEmailContent({ subject, body, recipientName, bookingId, templateName, isCustom, hallOwnerId }) {
    const logoUrl = await this.getHallOwnerLogo(hallOwnerId);
    
    // Create a more flexible template for customized emails
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Cranbourne Public Hall - ${subject}</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f1f5f9;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 40px 20px; text-align: center;">
            <img src="${logoUrl}" alt="Cranbourne Public Hall" draggable="false" style="max-width: 120px; height: auto; -webkit-user-drag: none; user-select: none; pointer-events: none;">
            <h1 style="color: white; margin: 20px 0 0 0; font-size: 24px; font-weight: 600;">Cranbourne Public Hall</h1>
          </div>
          
          <!-- Content -->
          <div style="padding: 40px 30px;">
            <h2 style="color: #1e293b; margin: 0 0 20px 0; font-size: 28px; font-weight: 700;">${subject}</h2>
            
            <div style="color: #475569; line-height: 1.6; font-size: 16px; margin-bottom: 20px;">
              ${this.formatEmailBody(body)}
            </div>
            
            <div style="border-top: 1px solid #e2e8f0; margin-top: 40px; padding-top: 30px; text-align: center;">
              <p style="color: #64748b; font-size: 14px; margin: 0 0 10px 0;">
                Thank you for choosing Cranbourne Public Hall!
              </p>
              <p style="color: #64748b; font-size: 14px; margin: 0;">
                If you have any questions, please don't hesitate to contact us.
              </p>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="color: #64748b; font-size: 12px; margin: 0 0 10px 0;">
              Cranbourne Public Hall Management System
            </p>
            <p style="color: #64748b; font-size: 12px; margin: 0;">
              ${isCustom ? 'This is a custom message from our team.' : `Template: ${templateName || 'Custom'}`}
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    return {
      subject: `Cranbourne Public Hall - ${subject}`,
      text: body,
      html: htmlContent
    };
  }

  formatEmailBody(body) {
    if (!body) return '';
    
    // Convert line breaks to HTML
    return body
      .replace(/\n/g, '<br>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>');
  }

  async sendQuotationEmail(quotationData, pdfBuffer) {
    try {
      const subject = `Quotation ${quotationData.id} - ${quotationData.eventType}`;
      const ratePct = Number.isFinite(Number(quotationData.taxRate)) ? Number(quotationData.taxRate) : 10;
      const rate = ratePct / 100;
      const isInclusive = quotationData.taxType === 'Exclusive' ? false : true;
      const rawTotal = Number(quotationData.totalAmount || 0);
      const subtotal = Number.isFinite(Number(quotationData.subtotal))
        ? Number(quotationData.subtotal)
        : (isInclusive ? Math.round((rawTotal / (1 + rate)) * 100) / 100 : Math.round(rawTotal * 100) / 100);
      const gst = Number.isFinite(Number(quotationData.gst))
        ? Number(quotationData.gst)
        : (isInclusive ? Math.round((rawTotal - subtotal) * 100) / 100 : Math.round((subtotal * rate) * 100) / 100);
      const totalInclGst = Number.isFinite(Number(quotationData.totalInclGst))
        ? Number(quotationData.totalInclGst)
        : (isInclusive ? Math.round(rawTotal * 100) / 100 : Math.round((subtotal + gst) * 100) / 100);
      const depositAmount = Number(quotationData.depositAmount || 0);
      const finalAmount = Number.isFinite(Number(quotationData.finalAmount))
        ? Number(quotationData.finalAmount)
        : Math.max(0, Math.round((totalInclGst - depositAmount) * 100) / 100);

      const depositLine = quotationData.depositType && quotationData.depositType !== 'None'
        ? `\n- Deposit: $${depositAmount.toFixed(2)} AUD`
        : '';
      const message = `Dear ${quotationData.customerName},\n\nPlease find attached your quotation for ${quotationData.eventType} at Cranbourne Public Hall.\n\nEvent Details:\n- Date: ${new Date(quotationData.eventDate).toLocaleDateString()}\n- Time: ${quotationData.startTime} - ${quotationData.endTime}\n- Resource: ${quotationData.resource}\n\nCharges (AUD):\n- Subtotal: $${subtotal.toFixed(2)}\n- GST (${ratePct}%): $${gst.toFixed(2)}\n- Total (incl. GST): $${totalInclGst.toFixed(2)}${depositLine}\n- Final Payment Due: $${finalAmount.toFixed(2)}\n\nThis quotation is valid until ${new Date(quotationData.validUntil).toLocaleDateString()}.\n\nTo accept this quotation, please reply to this email or contact us directly.\n\nThank you for considering Cranbourne Public Hall for your event!`;

      const mailOptions = {
        from: 'dpawan434741@gmail.com',
        to: quotationData.customerEmail,
        subject: subject,
        html: await this.generateQuotationHTMLTemplate(quotationData),
        text: message,
        attachments: [
          {
            filename: `quotation-${quotationData.id}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf'
          }
        ]
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ Quotation email sent successfully:', result.messageId);
      return result;
    } catch (error) {
      console.error('❌ Failed to send quotation email:', error);
      throw error;
    }
  }

  async generateQuotationHTMLTemplate(quotationData) {
    const logoUrl = await this.getHallOwnerLogo(quotationData.hallOwnerId);
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Cranbourne Public Hall - Quotation ${quotationData.id}</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f1f5f9;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 40px 20px; text-align: center;">
            <img src="${logoUrl}" alt="Cranbourne Public Hall" draggable="false" style="max-width: 120px; height: auto; -webkit-user-drag: none; user-select: none; pointer-events: none;">
            <h1 style="color: white; margin: 20px 0 0 0; font-size: 24px; font-weight: 600;">Cranbourne Public Hall</h1>
          </div>
          
          <!-- Content -->
          <div style="padding: 40px 30px;">
            <h2 style="color: #1e293b; margin: 0 0 20px 0; font-size: 28px; font-weight: 700;">Quotation ${quotationData.id}</h2>
            
            <div style="color: #475569; line-height: 1.6; font-size: 16px; margin-bottom: 20px;">
              Dear ${quotationData.customerName},
            </div>
            
            <div style="color: #475569; line-height: 1.6; font-size: 16px; margin-bottom: 20px;">
              Please find attached your quotation for <strong>${quotationData.eventType}</strong> at Cranbourne Public Hall.
            </div>
            
            <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="color: #1e293b; margin: 0 0 15px 0;">Event Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Event Type:</td>
                  <td style="padding: 8px 0; color: #1e293b;">${quotationData.eventType}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Date:</td>
                  <td style="padding: 8px 0; color: #1e293b;">${new Date(quotationData.eventDate).toLocaleDateString()}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Time:</td>
                  <td style="padding: 8px 0; color: #1e293b;">${quotationData.startTime} - ${quotationData.endTime}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Resource:</td>
                  <td style="padding: 8px 0; color: #1e293b;">${quotationData.resource}</td>
                </tr>
                ${(() => {
                  const ratePct = Number.isFinite(Number(quotationData.taxRate)) ? Number(quotationData.taxRate) : 10;
                  const rate = ratePct / 100;
                  const isInclusive = quotationData.taxType === 'Exclusive' ? false : true;
                  const rawTotal = Number(quotationData.totalAmount || 0);
                  const subtotal = Number.isFinite(Number(quotationData.subtotal))
                    ? Number(quotationData.subtotal)
                    : (isInclusive ? Math.round((rawTotal / (1 + rate)) * 100) / 100 : Math.round(rawTotal * 100) / 100);
                  const gst = Number.isFinite(Number(quotationData.gst))
                    ? Number(quotationData.gst)
                    : (isInclusive ? Math.round((rawTotal - subtotal) * 100) / 100 : Math.round((subtotal * rate) * 100) / 100);
                  const totalInclGst = Number.isFinite(Number(quotationData.totalInclGst))
                    ? Number(quotationData.totalInclGst)
                    : (isInclusive ? Math.round(rawTotal * 100) / 100 : Math.round((subtotal + gst) * 100) / 100);
                  const depositAmount = Number(quotationData.depositAmount || 0);
                  const finalAmount = Number.isFinite(Number(quotationData.finalAmount))
                    ? Number(quotationData.finalAmount)
                    : Math.max(0, Math.round((totalInclGst - depositAmount) * 100) / 100);
                  return `
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Subtotal:</td>
                  <td style="padding: 8px 0; color: #1e293b;">$${subtotal.toFixed(2)} AUD</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">GST (${ratePct}%):</td>
                  <td style="padding: 8px 0; color: #1e293b;">$${gst.toFixed(2)} AUD</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Total (incl. GST):</td>
                  <td style="padding: 8px 0; color: #059669; font-weight: bold; font-size: 18px;">$${totalInclGst.toFixed(2)} AUD</td>
                </tr>
                ${quotationData.depositType && quotationData.depositType !== 'None' ? `
                <tr style="background-color: #dbeafe; border-top: 2px solid #3b82f6; border-bottom: 2px solid #3b82f6;">
                  <td style="padding: 12px 8px; color: #1e40af; font-weight: 800;">💰 Deposit (pay first):</td>
                  <td style="padding: 12px 8px; color: #1e40af; font-weight: 800; text-align: right;">-$${depositAmount.toFixed(2)} AUD</td>
                </tr>
                <tr>
                  <td colspan="2" style="padding: 6px 8px; color: #1e3a8a; font-size: 12px;">
                    Paying the deposit confirms your booking. You'll receive a booking confirmation once paid.
                  </td>
                </tr>` : ''}
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Final Payment Due:</td>
                  <td style="padding: 8px 0; color: #059669; font-weight: bold; font-size: 18px;">$${finalAmount.toFixed(2)} AUD</td>
                </tr>`; })()}
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Valid Until:</td>
                  <td style="padding: 8px 0; color: #1e293b;">${new Date(quotationData.validUntil).toLocaleDateString()}</td>
                </tr>
              </table>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <p style="color: #64748b; margin-bottom: 20px;">To accept this quotation, please reply to this email or contact us directly.</p>
              <a href="mailto:dpawan434741@gmail.com" 
                 style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                Accept Quotation
              </a>
            </div>
            
            <div style="border-top: 1px solid #e2e8f0; margin-top: 40px; padding-top: 30px; text-align: center;">
              <p style="color: #64748b; font-size: 14px; margin: 0 0 10px 0;">
                Thank you for considering Cranbourne Public Hall for your event!
              </p>
              <p style="color: #64748b; font-size: 14px; margin: 0;">
                If you have any questions, please don't hesitate to contact us.
              </p>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="color: #64748b; font-size: 12px; margin: 0 0 10px 0;">
              Cranbourne Public Hall Management System
            </p>
            <p style="color: #64748b; font-size: 12px; margin: 0;">
              This quotation is valid until ${new Date(quotationData.validUntil).toLocaleDateString()}.
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  async sendBookingConfirmationEmail(bookingData) {
    try {
      const { 
        customerName, 
        customerEmail, 
        eventType, 
        resource, 
        eventDate, 
        startTime, 
        endTime, 
        guestCount, 
        totalAmount, 
        bookingId, 
        quotationId, 
        notes,
        hallOwnerId 
      } = bookingData;

      // Prefer human-readable venue name if available
      const venueName = bookingData.hallName || bookingData.resourceName || resource;

      const mailOptions = {
        from: 'dpawan434741@gmail.com',
        to: customerEmail,
        subject: `Booking Confirmed - ${eventType} at ${venueName}`,
        html: await this.generateBookingConfirmationHTML({
          customerName,
          eventType,
          resource: venueName,
          eventDate,
          startTime,
          endTime,
          guestCount,
          totalAmount,
          bookingId,
          quotationId,
          notes,
          hallOwnerId
        })
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ Booking confirmation email sent successfully:', result.messageId);
      return result;
    } catch (error) {
      console.error('❌ Failed to send booking confirmation email:', error);
      throw error;
    }
  }

  async generateBookingConfirmationHTML(bookingData) {
    const { 
      customerName, 
      eventType, 
      resource, 
      eventDate, 
      startTime, 
      endTime, 
      guestCount, 
      totalAmount, 
      bookingId, 
      quotationId, 
      notes, 
      taxType, 
      taxRate, 
      depositType, 
      depositValue, 
      depositAmount,
      hallOwnerId 
    } = bookingData;

    // Fetch company logo
    const logoUrl = await this.getHallOwnerLogo(hallOwnerId);

    // Fetch accepted payment methods and bank details for this hall owner
    let paymentMethods = { bankTransfer: true, cash: true, cheque: false };
    let bankDetails = null;
    try {
      [paymentMethods, bankDetails] = await Promise.all([
        this.getHallOwnerPaymentMethods(hallOwnerId),
        this.getHallOwnerBankDetails(hallOwnerId)
      ]);
    } catch (_) {
      // best-effort only
    }

    // Compute normalized amounts using provided taxType/taxRate with safe defaults
    const ratePct = Number.isFinite(Number(taxRate)) ? Number(taxRate) : 10;
    const rate = ratePct / 100;
    const isInclusive = taxType === 'Exclusive' ? false : true;
    const rawTotal = Number(totalAmount || 0);
    const subtotal = isInclusive
      ? Math.round((rawTotal / (1 + rate)) * 100) / 100
      : Math.round(rawTotal * 100) / 100;
    const gst = isInclusive
      ? Math.round((rawTotal - subtotal) * 100) / 100
      : Math.round((subtotal * rate) * 100) / 100;
    const totalInclGst = isInclusive ? Math.round(rawTotal * 100) / 100 : Math.round((subtotal + gst) * 100) / 100;
    const depAmt = (() => {
      if (depositType === 'Fixed') return Math.max(0, Math.round((Number(depositAmount ?? depositValue) || 0) * 100) / 100);
      if (depositType === 'Percentage') {
        const pct = Math.max(0, Math.min(100, Number(depositValue) || 0));
        return Math.round(((totalInclGst * pct) / 100) * 100) / 100;
      }
      return Number(depositAmount || 0) || 0;
    })();
    const finalDue = Math.max(0, Math.round((totalInclGst - depAmt) * 100) / 100);

    const methodsChips = [
      paymentMethods?.bankTransfer ? '<span style="display:inline-block;background:#eef2ff;color:#3730a3;padding:6px 10px;border-radius:9999px;font-size:12px;font-weight:600;margin-right:6px;">Bank Transfer</span>' : '',
      paymentMethods?.cash ? '<span style="display:inline-block;background:#ecfccb;color:#365314;padding:6px 10px;border-radius:9999px;font-size:12px;font-weight:600;margin-right:6px;">Cash</span>' : '',
      paymentMethods?.cheque ? '<span style="display:inline-block;background:#fffbeb;color:#92400e;padding:6px 10px;border-radius:9999px;font-size:12px;font-weight:600;margin-right:6px;">Cheque</span>' : ''
    ].join('');

    const bankHtml = (paymentMethods?.bankTransfer && bankDetails)
      ? `
        <div style="background-color:#fff7ed;border:1px solid #fdba74;border-radius:8px;padding:16px;margin-top:12px;">
          <div style="color:#9a3412;font-weight:800;margin-bottom:8px;">Bank Transfer Details</div>
          <table style="width:100%;border-collapse:collapse;">
            ${bankDetails.accountName ? `<tr><td style=\"padding:6px 0;color:#92400e;font-weight:600;\">Account Name:</td><td style=\"padding:6px 0;color:#7c2d12;text-align:right;\">${bankDetails.accountName}</td></tr>` : ''}
            ${bankDetails.bankName ? `<tr><td style=\"padding:6px 0;color:#92400e;font-weight:600;\">Bank:</td><td style=\"padding:6px 0;color:#7c2d12;text-align:right;\">${bankDetails.bankName}</td></tr>` : ''}
            ${bankDetails.bsb ? `<tr><td style=\"padding:6px 0;color:#92400e;font-weight:600;\">BSB:</td><td style=\"padding:6px 0;color:#7c2d12;text-align:right;\">${bankDetails.bsb}</td></tr>` : ''}
            ${bankDetails.accountNumber ? `<tr><td style=\"padding:6px 0;color:#92400e;font-weight:600;\">Account Number:</td><td style=\"padding:6px 0;color:#7c2d12;text-align:right;\">${bankDetails.accountNumber}</td></tr>` : ''}
          </table>
          ${(bookingId || bankDetails.referenceNote) ? `<div style=\"margin-top:8px;color:#9a3412;font-size:12px;\">Reference: <strong>${bankDetails.referenceNote || 'Please use your booking reference'}</strong>${bookingId ? ` (<span style=\"font-family:monospace;\">${bookingId}</span>)` : ''}</div>` : ''}
        </div>
      ` : '';

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Booking Confirmation</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f8fafc;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
          
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">
              🎉 Booking Confirmed!
            </h1>
            <p style="color: #e2e8f0; margin: 10px 0 0 0; font-size: 16px;">
              Your quotation has been accepted and your booking is now confirmed
            </p>
          </div>
          
          <!-- Main Content -->
          <div style="padding: 40px 30px;">
            <div style="background-color: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
              <h2 style="color: #0c4a6e; margin: 0 0 15px 0; font-size: 20px;">
                ✅ Booking Details
              </h2>
              <p style="color: #0c4a6e; margin: 0; font-size: 16px;">
                Dear ${customerName},<br><br>
                We're excited to confirm that your quotation has been accepted and your booking is now confirmed! 
                We look forward to hosting your event.
              </p>
            </div>
            
            <!-- Event Information -->
            <div style="background-color: #f8fafc; border-radius: 8px; padding: 25px; margin-bottom: 25px;">
              <h3 style="color: #1e293b; margin: 0 0 20px 0; font-size: 18px; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">
                📅 Event Information
              </h3>
              
              <div style="display: grid; gap: 15px;">
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
                  <span style="color: #64748b; font-weight: 500;">Event Type:</span>
                  <span style="color: #1e293b; font-weight: 600;">${eventType}</span>
                </div>
                
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
                  <span style="color: #64748b; font-weight: 500;">Venue:</span>
                  <span style="color: #1e293b; font-weight: 600;">${resource}</span>
                </div>
                
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
                  <span style="color: #64748b; font-weight: 500;">Date:</span>
                  <span style="color: #1e293b; font-weight: 600;">${new Date(eventDate).toLocaleDateString('en-AU', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}</span>
                </div>
                
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
                  <span style="color: #64748b; font-weight: 500;">Time:</span>
                  <span style="color: #1e293b; font-weight: 600;">${startTime} - ${endTime}</span>
                </div>
                
                ${guestCount ? `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
                  <span style="color: #64748b; font-weight: 500;">Guest Count:</span>
                  <span style="color: #1e293b; font-weight: 600;">${guestCount} guests</span>
                </div>
                ` : ''}
                
                <div style="display: grid; gap: 10px;">
                  <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px dashed #e2e8f0;">
                    <span style="color: #64748b; font-weight: 500;">Subtotal:</span>
                    <span style="color: #1e293b; font-weight: 600;">$${subtotal.toFixed(2)} AUD</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px dashed #e2e8f0;">
                    <span style="color: #64748b; font-weight: 500;">GST (${ratePct}%):</span>
                    <span style="color: #1e293b; font-weight: 600;">$${gst.toFixed(2)} AUD</span>
                  </div>
                  <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0;">
                    <span style="color: #64748b; font-weight: 500;">Total (incl. GST):</span>
                    <span style="color: #059669; font-weight: 700; font-size: 18px;">$${totalInclGst.toFixed(2)} AUD</span>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- Booking References -->
            <div style="background-color: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
              <h3 style="color: #92400e; margin: 0 0 15px 0; font-size: 16px;">
                📋 Booking References
              </h3>
              <div style="display: grid; gap: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="color: #92400e; font-weight: 500;">Booking ID:</span>
                  <span style="color: #92400e; font-weight: 600; font-family: monospace;">${bookingId}</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="color: #92400e; font-weight: 500;">Original Quotation:</span>
                  <span style="color: #92400e; font-weight: 600; font-family: monospace;">${quotationId}</span>
                </div>
              </div>
            </div>
            
            ${notes ? `
            <!-- Additional Notes -->
            <div style="background-color: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
              <h3 style="color: #0c4a6e; margin: 0 0 15px 0; font-size: 16px;">
                📝 Additional Notes
              </h3>
              <p style="color: #0c4a6e; margin: 0; line-height: 1.6;">
            ${notes}
              </p>
            </div>
            ` : ''}
            
          <!-- Payment Methods -->
          <div style="background-color: #f8fafc; border-radius: 8px; padding: 20px; margin-bottom: 25px; border: 1px solid #e2e8f0;">
            <h3 style="color: #1e293b; margin: 0 0 12px 0; font-size: 16px;">Accepted Payment Methods</h3>
            <div>${methodsChips || '<span style="color:#64748b;font-size:14px;">Payment methods will be sent with your invoice.</span>'}</div>
            ${bankHtml}
          </div>

            <!-- Next Steps -->
            <div style="background-color: #eff6ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
              <h3 style="color: #15803d; margin: 0 0 15px 0; font-size: 16px;">
                💰 Deposit and Next Steps
              </h3>
              <div style="background-color: #dbeafe; border: 2px solid #3b82f6; border-radius: 6px; padding: 12px; margin: 10px 0;">
                <div style="display: flex; justify-content: space-between; font-weight: 800; color: #1e40af;">
                  <span>Deposit (pay first):</span>
                  <span>-$${depAmt.toFixed(2)} AUD</span>
                </div>
                <div style="margin-top: 6px; color: #1e3a8a; font-size: 12px;">
                  Paying the deposit confirms your booking. You'll receive a confirmation receipt once paid.
                </div>
              </div>
              <div style="background-color: #dcfce7; border: 2px solid #22c55e; border-radius: 6px; padding: 12px; margin: 10px 0;">
                <div style="display: flex; justify-content: space-between; font-weight: 800; color: #166534;">
                  <span>Final Payment Due:</span>
                  <span>$${finalDue.toFixed(2)} AUD</span>
                </div>
              </div>
              <ul style="color: #0c4a6e; margin: 0; padding-left: 20px; line-height: 1.6;">
                <li>We'll send invoices with payment details.</li>
                <li>Closer to the event, we'll contact you with setup details.</li>
                <li>Questions? Reply to this email with your booking reference.</li>
              </ul>
            </div>
            
            <div style="border-top: 1px solid #e2e8f0; margin-top: 40px; padding-top: 30px; text-align: center;">
              <p style="color: #64748b; font-size: 14px; margin: 0 0 10px 0;">
                Thank you for choosing Cranbourne Public Hall for your event!
              </p>
              <p style="color: #64748b; font-size: 14px; margin: 0;">
                We look forward to making your event memorable.
              </p>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="color: #64748b; font-size: 12px; margin: 0 0 10px 0;">
              Cranbourne Public Hall Management System
            </p>
            <p style="color: #64748b; font-size: 12px; margin: 0;">
              Booking confirmed on ${new Date().toLocaleDateString('en-AU')}
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  async sendQuotationDeclineEmail(quotationData) {
    try {
      const { 
        customerName, 
        customerEmail, 
        eventType, 
        resource, 
        eventDate, 
        quotationId,
        hallOwnerId 
      } = quotationData;

      const mailOptions = {
        from: 'dpawan434741@gmail.com',
        to: customerEmail,
        subject: `Quotation Update - ${eventType} at ${resource}`,
        html: await this.generateQuotationDeclineHTML({
          customerName,
          eventType,
          resource,
          eventDate,
          quotationId,
          hallOwnerId
        })
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ Quotation decline email sent successfully:', result.messageId);
      return result;
    } catch (error) {
      console.error('❌ Failed to send quotation decline email:', error);
      throw error;
    }
  }

  async generateQuotationDeclineHTML(quotationData) {
    const { 
      customerName, 
      eventType, 
      resource, 
      eventDate, 
      quotationId,
      hallOwnerId 
    } = quotationData;

    const logoUrl = await this.getHallOwnerLogo(hallOwnerId);

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Quotation Update</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f8fafc;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff;">
          
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 40px 30px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: bold;">
              📋 Quotation Update
            </h1>
            <p style="color: #fef3c7; margin: 10px 0 0 0; font-size: 16px;">
              Update regarding your quotation request
            </p>
          </div>
          
          <!-- Main Content -->
          <div style="padding: 40px 30px;">
            <div style="background-color: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 20px; margin-bottom: 30px;">
              <h2 style="color: #92400e; margin: 0 0 15px 0; font-size: 20px;">
                📝 Quotation Status Update
              </h2>
              <p style="color: #92400e; margin: 0; font-size: 16px;">
                Dear ${customerName},<br><br>
                Thank you for your interest in hosting your event at Cranbourne Public Hall. 
                We regret to inform you that we are unable to proceed with your quotation request at this time.
              </p>
            </div>
            
            <!-- Event Information -->
            <div style="background-color: #f8fafc; border-radius: 8px; padding: 25px; margin-bottom: 25px;">
              <h3 style="color: #1e293b; margin: 0 0 20px 0; font-size: 18px; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px;">
                📅 Requested Event Details
              </h3>
              
              <div style="display: grid; gap: 15px;">
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
                  <span style="color: #64748b; font-weight: 500;">Event Type:</span>
                  <span style="color: #1e293b; font-weight: 600;">${eventType}</span>
                </div>
                
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid #e2e8f0;">
                  <span style="color: #64748b; font-weight: 500;">Venue:</span>
                  <span style="color: #1e293b; font-weight: 600;">${resource}</span>
                </div>
                
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0;">
                  <span style="color: #64748b; font-weight: 500;">Requested Date:</span>
                  <span style="color: #1e293b; font-weight: 600;">${new Date(eventDate).toLocaleDateString('en-AU', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}</span>
                </div>
              </div>
            </div>
            
            <!-- Quotation Reference -->
            <div style="background-color: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
              <h3 style="color: #92400e; margin: 0 0 15px 0; font-size: 16px;">
                📋 Quotation Reference
              </h3>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: #92400e; font-weight: 500;">Quotation ID:</span>
                <span style="color: #92400e; font-weight: 600; font-family: monospace;">${quotationId}</span>
              </div>
            </div>
            
            <!-- Next Steps -->
            <div style="background-color: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
              <h3 style="color: #0c4a6e; margin: 0 0 15px 0; font-size: 16px;">
                🔄 Alternative Options
              </h3>
              <ul style="color: #0c4a6e; margin: 0; padding-left: 20px; line-height: 1.6;">
                <li>Consider alternative dates that may be available</li>
                <li>Contact us to discuss other venue options</li>
                <li>We can help you find suitable alternatives for your event</li>
                <li>Feel free to reach out if you have any questions</li>
              </ul>
            </div>
            
            <div style="border-top: 1px solid #e2e8f0; margin-top: 40px; padding-top: 30px; text-align: center;">
              <p style="color: #64748b; font-size: 14px; margin: 0 0 10px 0;">
                We appreciate your interest in Cranbourne Public Hall.
              </p>
              <p style="color: #64748b; font-size: 14px; margin: 0;">
                Please don't hesitate to contact us for future events or any questions.
              </p>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="color: #64748b; font-size: 12px; margin: 0 0 10px 0;">
              Cranbourne Public Hall Management System
            </p>
            <p style="color: #64748b; font-size: 12px; margin: 0;">
              Quotation updated on ${new Date().toLocaleDateString('en-AU')}
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  async sendInvoiceEmail(invoiceData, pdfBuffer) {
    try {
      const subject = `Invoice ${invoiceData.invoiceNumber} - ${invoiceData.invoiceType}`;
      
      // Enhanced message with deposit information
      let message = `Dear ${invoiceData.customer.name},\n\nPlease find attached your invoice for ${invoiceData.invoiceType} payment.\n\nInvoice Details:\n- Invoice Number: ${invoiceData.invoiceNumber}\n- Issue Date: ${this.formatDateAU(invoiceData.issueDate)}\n- Due Date: ${this.formatDateAU(invoiceData.dueDate)}\n- Booking Source: ${invoiceData.bookingSource || 'Direct'}`;
      
      // Add quotation information if applicable
      if (invoiceData.bookingSource === 'quotation' && invoiceData.quotationId) {
        message += `\n- Quotation ID: ${invoiceData.quotationId}`;
      }
      
      // Add deposit and final price information
      if (invoiceData.depositPaid > 0) {
        const fullAmount = invoiceData.fullAmountWithGST || invoiceData.total;
        message += `\n\n💰 PAYMENT BREAKDOWN:\n- Full Amount (with GST): $${fullAmount.toFixed(2)} AUD\n- 💰 Deposit Already Paid: $${invoiceData.depositPaid.toFixed(2)} AUD\n\n💳 FINAL PAYMENT DUE: $${invoiceData.finalTotal.toFixed(2)} AUD\n\nCalculation: $${fullAmount.toFixed(2)} - $${invoiceData.depositPaid.toFixed(2)} = $${invoiceData.finalTotal.toFixed(2)} AUD`;
      } else {
        message += `\n\n💳 AMOUNT YOU NEED TO PAY: $${invoiceData.total.toFixed(2)} AUD`;
      }
      
      message += `\n- Status: ${invoiceData.status}\n\nPayment is due within 30 days of the invoice date. Please refer to the attached PDF for payment details and bank information.\n\nThank you for your business!`;

      const mailOptions = {
        from: 'dpawan434741@gmail.com',
        to: invoiceData.customer.email,
        subject: subject,
        html: await this.generateInvoiceHTMLTemplate(invoiceData),
        text: message,
        attachments: [
          {
            filename: `invoice-${invoiceData.invoiceNumber}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf'
          }
        ]
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ Invoice email sent successfully:', result.messageId);
      return result;
    } catch (error) {
      console.error('❌ Failed to send invoice email:', error);
      throw error;
    }
  }

  async generateInvoiceHTMLTemplate(invoiceData) {
    const logoUrl = await this.getHallOwnerLogo(invoiceData.hallOwnerId);
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Cranbourne Public Hall - Invoice ${invoiceData.invoiceNumber}</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f1f5f9;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 40px 20px; text-align: center;">
            <h1 style="color: white; margin: 20px 0 0 0; font-size: 24px; font-weight: 600;">Cranbourne Public Hall</h1>
          </div>
          
          <!-- Content -->
          <div style="padding: 40px 30px;">
            <h2 style="color: #1e293b; margin: 0 0 20px 0; font-size: 28px; font-weight: 700;">Invoice ${invoiceData.invoiceNumber}</h2>
            
            <div style="color: #475569; line-height: 1.6; font-size: 16px; margin-bottom: 20px;">
              Dear ${invoiceData.customer.name},
            </div>
            
            <div style="color: #475569; line-height: 1.6; font-size: 16px; margin-bottom: 20px;">
              Please find attached your invoice for <strong>${invoiceData.invoiceType}</strong> payment.
            </div>
            
            <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="color: #1e293b; margin: 0 0 15px 0;">Invoice Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Invoice Number:</td>
                  <td style="padding: 8px 0; color: #1e293b;">${invoiceData.invoiceNumber}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Issue Date:</td>
                  <td style="padding: 8px 0; color: #1e293b;">${this.formatDateAU(invoiceData.issueDate)}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Due Date:</td>
                  <td style="padding: 8px 0; color: #1e293b;">${this.formatDateAU(invoiceData.dueDate)}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Invoice Type:</td>
                  <td style="padding: 8px 0; color: #1e293b;">${invoiceData.invoiceType}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Booking Source:</td>
                  <td style="padding: 8px 0; color: #1e293b;">${invoiceData.bookingSource || 'Direct'}</td>
                </tr>
                ${invoiceData.bookingSource === 'quotation' && invoiceData.quotationId ? `
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Quotation ID:</td>
                  <td style="padding: 8px 0; color: #1e293b;">${invoiceData.quotationId}</td>
                </tr>
                ` : ''}
                ${invoiceData.depositPaid > 0 ? `
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Full Amount (with GST):</td>
                  <td style="padding: 8px 0; color: #1e293b;">$${(invoiceData.fullAmountWithGST || invoiceData.total).toFixed(2)} AUD</td>
                </tr>
                <tr style="background-color: #dbeafe;">
                  <td style="padding: 12px 8px; color: #1e40af; font-weight: bold; font-size: 16px;">💰 Deposit Already Paid:</td>
                  <td style="padding: 12px 8px; color: #1e40af; font-weight: bold; font-size: 16px;">-$${invoiceData.depositPaid.toFixed(2)} AUD</td>
                </tr>
                <tr style="background-color: #dcfce7; border: 2px solid #22c55e;">
                  <td style="padding: 15px 8px; color: #166534; font-weight: bold; font-size: 20px;">💳 Final Payment Due:</td>
                  <td style="padding: 15px 8px; color: #166534; font-weight: bold; font-size: 20px;">$${invoiceData.finalTotal.toFixed(2)} AUD</td>
                </tr>
                ` : `
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Subtotal:</td>
                  <td style="padding: 8px 0; color: #1e293b;">$${invoiceData.subtotal.toFixed(2)}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">GST (10%):</td>
                  <td style="padding: 8px 0; color: #1e293b;">$${invoiceData.gst.toFixed(2)}</td>
                </tr>
                <tr style="background-color: #dcfce7; border: 2px solid #22c55e;">
                  <td style="padding: 15px 8px; color: #166534; font-weight: bold; font-size: 20px;">💳 Amount Due:</td>
                  <td style="padding: 15px 8px; color: #166534; font-weight: bold; font-size: 20px;">$${invoiceData.total.toFixed(2)} AUD</td>
                </tr>
                `}
              </table>
            </div>
            
            ${invoiceData.bookingSource === 'quotation' && invoiceData.quotationId ? `
            <div style="background-color: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <h3 style="color: #92400e; margin: 0 0 15px 0; font-size: 18px;">📋 Quotation Information</h3>
              <div style="color: #92400e; font-size: 14px; line-height: 1.6;">
                <p style="margin: 0 0 10px 0;">This invoice is based on your accepted quotation <strong>${invoiceData.quotationId}</strong>.</p>
                ${invoiceData.depositPaid > 0 ? `
                <div style="background-color: #dbeafe; border: 1px solid #3b82f6; border-radius: 6px; padding: 12px; margin: 10px 0;">
                  <p style="margin: 0 0 8px 0; color: #1e40af; font-weight: bold;">💰 Deposit Information:</p>
                  <p style="margin: 0 0 8px 0; color: #1e40af;">Your deposit of <strong>$${invoiceData.depositPaid.toFixed(2)} AUD</strong> has been deducted from the total amount.</p>
                </div>
                <div style="background-color: #dcfce7; border: 2px solid #22c55e; border-radius: 6px; padding: 12px; margin: 10px 0;">
                  <p style="margin: 0; color: #166534; font-weight: bold; font-size: 16px;">💳 Amount You Need to Pay: <strong>$${invoiceData.finalTotal.toFixed(2)} AUD</strong></p>
                </div>
                ` : `
                <div style="background-color: #dcfce7; border: 2px solid #22c55e; border-radius: 6px; padding: 12px; margin: 10px 0;">
                  <p style="margin: 0; color: #166534; font-weight: bold; font-size: 16px;">💳 Amount You Need to Pay: <strong>$${invoiceData.total.toFixed(2)} AUD</strong></p>
                </div>
                `}
              </div>
            </div>
            ` : ''}
            
            <div style="background-color: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <h3 style="color: #92400e; margin: 0 0 15px 0;">Payment Information</h3>
              <div style="color: #92400e; font-size: 14px; line-height: 1.6;">
                <p style="margin: 0 0 10px 0;"><strong>Payment Method:</strong> Bank Transfer</p>
                <p style="margin: 0 0 10px 0;"><strong>Account Name:</strong> Cranbourne Public Hall</p>
                <p style="margin: 0 0 10px 0;"><strong>BSB:</strong> 123-456</p>
                <p style="margin: 0;"><strong>Account Number:</strong> 12345678</p>
              </div>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <p style="color: #64748b; margin-bottom: 20px;">Payment is due within 30 days of the invoice date.</p>
              <a href="mailto:dpawan434741@gmail.com" 
                 style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                Contact Us
              </a>
            </div>
            
            <div style="border-top: 1px solid #e2e8f0; margin-top: 40px; padding-top: 30px; text-align: center;">
              <p style="color: #64748b; font-size: 14px; margin: 0 0 10px 0;">
                Thank you for your business!
              </p>
              <p style="color: #64748b; font-size: 14px; margin: 0;">
                If you have any questions about this invoice, please don't hesitate to contact us.
              </p>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="color: #64748b; font-size: 12px; margin: 0 0 10px 0;">
              Cranbourne Public Hall Management System
            </p>
            <p style="color: #64748b; font-size: 12px; margin: 0;">
              Invoice generated on ${new Date().toLocaleDateString('en-AU')}
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  async sendInvoiceReminderEmail(invoiceData) {
    try {
      const subject = `Payment Reminder - Invoice ${invoiceData.invoiceNumber}`;
      
      // Enhanced message with deposit information
      let message = `Dear ${invoiceData.customer.name},\n\nThis is a friendly reminder that your invoice ${invoiceData.invoiceNumber} is ${invoiceData.status === 'OVERDUE' ? 'overdue' : 'due for payment'}.\n\nInvoice Details:\n- Invoice Number: ${invoiceData.invoiceNumber}\n- Issue Date: ${this.formatDateAU(invoiceData.issueDate)}\n- Due Date: ${this.formatDateAU(invoiceData.dueDate)}\n- Invoice Type: ${invoiceData.invoiceType}\n- Booking Source: ${invoiceData.bookingSource || 'Direct'}`;
      
      // Add quotation information if applicable
      if (invoiceData.bookingSource === 'quotation' && invoiceData.quotationId) {
        message += `\n- Quotation ID: ${invoiceData.quotationId}`;
      }
      
      // Add deposit and final price information
      if (invoiceData.depositPaid > 0) {
        const fullAmount = invoiceData.fullAmountWithGST || invoiceData.total;
        message += `\n\n💰 PAYMENT BREAKDOWN:\n- Full Amount (with GST): $${fullAmount.toFixed(2)} AUD\n- 💰 Deposit Already Paid: $${invoiceData.depositPaid.toFixed(2)} AUD\n\n💳 FINAL PAYMENT DUE: $${invoiceData.finalTotal.toFixed(2)} AUD\n\nCalculation: $${fullAmount.toFixed(2)} - $${invoiceData.depositPaid.toFixed(2)} = $${invoiceData.finalTotal.toFixed(2)} AUD`;
      } else {
        message += `\n\n💳 AMOUNT YOU NEED TO PAY: $${invoiceData.total.toFixed(2)} AUD`;
      }
      
      // Add urgency based on status
      if (invoiceData.status === 'OVERDUE') {
        const daysOverdue = Math.ceil((new Date() - new Date(invoiceData.dueDate)) / (1000 * 60 * 60 * 24));
        message += `\n\n⚠️ URGENT: This invoice is ${daysOverdue} day(s) overdue. Please arrange payment as soon as possible to avoid additional charges.`;
      } else if (invoiceData.status === 'PARTIAL') {
        const balanceDue = invoiceData.total - invoiceData.paidAmount;
        message += `\n\n📋 PARTIAL PAYMENT: Thank you for your partial payment. The remaining balance of $${balanceDue.toFixed(2)} AUD is still due.`;
      } else {
        message += `\n\n⏰ Payment is due within 30 days of the invoice date. Please refer to the attached PDF for payment details and bank information.`;
      }
      
      message += `\n\nIf you have already made payment, please ignore this reminder. If you have any questions or need to discuss payment arrangements, please contact us directly.\n\nThank you for your prompt attention to this matter!`;

      const mailOptions = {
        from: 'dpawan434741@gmail.com',
        to: invoiceData.customer.email,
        subject: subject,
        html: await this.generateInvoiceReminderHTMLTemplate(invoiceData),
        text: message
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ Invoice reminder email sent successfully:', result.messageId);
      return result;
    } catch (error) {
      console.error('❌ Failed to send invoice reminder email:', error);
      throw error;
    }
  }

  async sendPaymentThankYouEmail(invoiceData) {
    try {
      const subject = `Payment received - Invoice ${invoiceData.invoiceNumber}`;
      const html = await this.generatePaymentThankYouHTML(invoiceData);
      const text = `Dear ${invoiceData.customer?.name || 'Customer'},\n\nThank you for your payment. We have marked your invoice ${invoiceData.invoiceNumber} as PAID.\n\nAmount: $${(invoiceData.finalTotal || invoiceData.total || 0).toFixed ? (invoiceData.finalTotal || invoiceData.total).toFixed(2) : invoiceData.finalTotal || invoiceData.total} AUD\nInvoice Type: ${invoiceData.invoiceType}\nIssue Date: ${new Date(invoiceData.issueDate).toLocaleDateString()}\n\nWe appreciate your business!`;

      const mailOptions = {
        from: 'dpawan434741@gmail.com',
        to: invoiceData.customer?.email,
        subject,
        html,
        text
      };

      const result = await this.transporter.sendMail(mailOptions);
      console.log('✅ Payment thank-you email sent successfully:', result.messageId);
      return result;
    } catch (error) {
      console.error('❌ Failed to send payment thank-you email:', error);
      throw error;
    }
  }

  async generatePaymentThankYouHTML(invoiceData) {
    const logoUrl = await this.getHallOwnerLogo(invoiceData.hallOwnerId);
    const amount = (invoiceData.finalTotal || invoiceData.total) || 0;
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payment Received - Invoice ${invoiceData.invoiceNumber}</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f1f5f9;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <div style="background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%); padding: 40px 20px; text-align: center;">
            <h1 style="color: white; margin: 20px 0 0 0; font-size: 24px; font-weight: 600;">Payment Received</h1>
          </div>
          <div style="padding: 40px 30px;">
            <h2 style="color: #1e293b; margin: 0 0 20px 0; font-size: 24px; font-weight: 700;">Thank you, ${invoiceData.customer?.name || 'Customer'}!</h2>
            <p style="color: #475569; line-height: 1.6; font-size: 16px;">We have received your payment and marked your invoice as <strong>PAID</strong>.</p>
            <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="color: #1e293b; margin: 0 0 15px 0;">Invoice Summary</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Invoice Number:</td>
                  <td style="padding: 8px 0; color: #1e293b;">${invoiceData.invoiceNumber}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Invoice Type:</td>
                  <td style="padding: 8px 0; color: #1e293b;">${invoiceData.invoiceType}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Issue Date:</td>
                  <td style="padding: 8px 0; color: #1e293b;">${new Date(invoiceData.issueDate).toLocaleDateString()}</td>
                </tr>
                <tr style="background-color: #dcfce7; border: 2px solid #22c55e;">
                  <td style="padding: 12px 8px; color: #166534; font-weight: bold;">Amount Paid:</td>
                  <td style="padding: 12px 8px; color: #166534; font-weight: bold; text-align: right;">$${amount.toFixed ? amount.toFixed(2) : amount} AUD</td>
                </tr>
              </table>
            </div>
            <p style="color: #475569; line-height: 1.6; font-size: 16px;">If you need a receipt or have any questions, please reply to this email.</p>
            <div style="border-top: 1px solid #e2e8f0; margin-top: 30px; padding-top: 20px; text-align: center;">
              <p style="color: #64748b; font-size: 14px; margin: 0;">We appreciate your business!</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  async generateInvoiceReminderHTMLTemplate(invoiceData) {
    const logoUrl = await this.getHallOwnerLogo(invoiceData.hallOwnerId);
    const isOverdue = invoiceData.status === 'OVERDUE';
    const daysOverdue = isOverdue ? Math.ceil((new Date() - new Date(invoiceData.dueDate)) / (1000 * 60 * 60 * 24)) : 0;
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Cranbourne Public Hall - Payment Reminder</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f1f5f9;">
        <div style="max-width: 600px; margin: 0 auto; background-color: white; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, ${isOverdue ? '#dc2626' : '#f59e0b'} 0%, ${isOverdue ? '#b91c1c' : '#d97706'} 100%); padding: 40px 20px; text-align: center;">
            <h1 style="color: white; margin: 20px 0 0 0; font-size: 24px; font-weight: 600;">Cranbourne Public Hall</h1>
          </div>
          
          <!-- Content -->
          <div style="padding: 40px 30px;">
            <h2 style="color: #1e293b; margin: 0 0 20px 0; font-size: 28px; font-weight: 700;">
              ${isOverdue ? '🚨 Payment Overdue' : '⏰ Payment Reminder'}
            </h2>
            
            <div style="color: #475569; line-height: 1.6; font-size: 16px; margin-bottom: 20px;">
              Dear ${invoiceData.customer.name},
            </div>
            
            <div style="color: #475569; line-height: 1.6; font-size: 16px; margin-bottom: 20px;">
              This is a friendly reminder that your invoice <strong>${invoiceData.invoiceNumber}</strong> is ${isOverdue ? 'overdue' : 'due for payment'}.
            </div>
            
            ${isOverdue ? `
            <div style="background-color: #fef2f2; border: 2px solid #dc2626; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <h3 style="color: #dc2626; margin: 0 0 10px 0; font-size: 18px;">⚠️ URGENT: Invoice Overdue</h3>
              <p style="color: #991b1b; margin: 0; font-weight: bold;">
                This invoice is ${daysOverdue} day(s) overdue. Please arrange payment as soon as possible to avoid additional charges.
              </p>
            </div>
            ` : ''}
            
            <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <h3 style="color: #1e293b; margin: 0 0 15px 0;">Invoice Details</h3>
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Invoice Number:</td>
                  <td style="padding: 8px 0; color: #1e293b;">${invoiceData.invoiceNumber}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Issue Date:</td>
                  <td style="padding: 8px 0; color: #1e293b;">${this.formatDateAU(invoiceData.issueDate)}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Due Date:</td>
                  <td style="padding: 8px 0; color: ${isOverdue ? '#dc2626' : '#1e293b'};">${this.formatDateAU(invoiceData.dueDate)}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Invoice Type:</td>
                  <td style="padding: 8px 0; color: #1e293b;">${invoiceData.invoiceType}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Booking Source:</td>
                  <td style="padding: 8px 0; color: #1e293b;">${invoiceData.bookingSource || 'Direct'}</td>
                </tr>
                ${invoiceData.bookingSource === 'quotation' && invoiceData.quotationId ? `
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Quotation ID:</td>
                  <td style="padding: 8px 0; color: #1e293b;">${invoiceData.quotationId}</td>
                </tr>
                ` : ''}
              </table>
            </div>
            
            <!-- Payment Breakdown -->
            <div style="background-color: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <h3 style="color: #0c4a6e; margin: 0 0 15px 0;">Payment Breakdown</h3>
              <table style="width: 100%; border-collapse: collapse;">
                ${invoiceData.depositPaid > 0 ? `
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Full Amount (with GST):</td>
                  <td style="padding: 8px 0; color: #1e293b; text-align: right;">$${(invoiceData.fullAmountWithGST || invoiceData.total).toFixed(2)} AUD</td>
                </tr>
                <tr style="background-color: #dbeafe;">
                  <td style="padding: 12px 8px; color: #1e40af; font-weight: bold; font-size: 16px;">💰 Deposit Already Paid:</td>
                  <td style="padding: 12px 8px; color: #1e40af; font-weight: bold; font-size: 16px; text-align: right;">-$${invoiceData.depositPaid.toFixed(2)} AUD</td>
                </tr>
                <tr style="background-color: #dcfce7; border: 2px solid #22c55e;">
                  <td style="padding: 15px 8px; color: #166534; font-weight: bold; font-size: 20px;">💳 Final Payment Due:</td>
                  <td style="padding: 15px 8px; color: #166534; font-weight: bold; font-size: 20px; text-align: right;">$${invoiceData.finalTotal.toFixed(2)} AUD</td>
                </tr>
                ` : `
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Subtotal:</td>
                  <td style="padding: 8px 0; color: #1e293b; text-align: right;">$${invoiceData.subtotal.toFixed(2)}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #64748b; font-weight: bold;">GST (10%):</td>
                  <td style="padding: 8px 0; color: #1e293b; text-align: right;">$${invoiceData.gst.toFixed(2)}</td>
                </tr>
                <tr style="background-color: #dcfce7; border: 2px solid #22c55e;">
                  <td style="padding: 15px 8px; color: #166534; font-weight: bold; font-size: 20px;">💳 Amount Due:</td>
                  <td style="padding: 15px 8px; color: #166534; font-weight: bold; font-size: 20px; text-align: right;">$${invoiceData.total.toFixed(2)} AUD</td>
                </tr>
                `}
              </table>
            </div>
            
            ${invoiceData.status === 'PARTIAL' ? `
            <div style="background-color: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <h3 style="color: #92400e; margin: 0 0 15px 0;">📋 Partial Payment Received</h3>
              <p style="color: #92400e; margin: 0;">
                Thank you for your partial payment of $${invoiceData.paidAmount.toFixed(2)} AUD. 
                The remaining balance of $${(invoiceData.total - invoiceData.paidAmount).toFixed(2)} AUD is still due.
              </p>
            </div>
            ` : ''}
            
            ${invoiceData.bookingSource === 'quotation' && invoiceData.quotationId ? `
            <div style="background-color: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <h3 style="color: #92400e; margin: 0 0 15px 0; font-size: 18px;">📋 Quotation Information</h3>
              <div style="color: #92400e; font-size: 14px; line-height: 1.6;">
                <p style="margin: 0 0 10px 0;">This invoice is based on your accepted quotation <strong>${invoiceData.quotationId}</strong>.</p>
                ${invoiceData.depositPaid > 0 ? `
                <div style="background-color: #dbeafe; border: 1px solid #3b82f6; border-radius: 6px; padding: 12px; margin: 10px 0;">
                  <p style="margin: 0 0 8px 0; color: #1e40af; font-weight: bold;">💰 Deposit Information:</p>
                  <p style="margin: 0 0 8px 0; color: #1e40af;">Your deposit of <strong>$${invoiceData.depositPaid.toFixed(2)} AUD</strong> has been deducted from the total amount.</p>
                </div>
                <div style="background-color: #dcfce7; border: 2px solid #22c55e; border-radius: 6px; padding: 12px; margin: 10px 0;">
                  <p style="margin: 0; color: #166534; font-weight: bold; font-size: 16px;">💳 Amount You Need to Pay: <strong>$${invoiceData.finalTotal.toFixed(2)} AUD</strong></p>
                </div>
                ` : `
                <div style="background-color: #dcfce7; border: 2px solid #22c55e; border-radius: 6px; padding: 12px; margin: 10px 0;">
                  <p style="margin: 0; color: #166534; font-weight: bold; font-size: 16px;">💳 Amount You Need to Pay: <strong>$${invoiceData.total.toFixed(2)} AUD</strong></p>
                </div>
                `}
              </div>
            </div>
            ` : ''}
            
            <div style="background-color: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 20px; margin: 20px 0;">
              <h3 style="color: #92400e; margin: 0 0 15px 0;">Payment Information</h3>
              <div style="color: #92400e; font-size: 14px; line-height: 1.6;">
                <p style="margin: 0 0 10px 0;"><strong>Payment Method:</strong> Bank Transfer</p>
                <p style="margin: 0 0 10px 0;"><strong>Account Name:</strong> Cranbourne Public Hall</p>
                <p style="margin: 0 0 10px 0;"><strong>BSB:</strong> 123-456</p>
                <p style="margin: 0;"><strong>Account Number:</strong> 12345678</p>
              </div>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <p style="color: #64748b; margin-bottom: 20px;">
                ${isOverdue ? 'Please arrange payment immediately to avoid additional charges.' : 'Payment is due within 30 days of the invoice date.'}
              </p>
              <a href="mailto:dpawan434741@gmail.com" 
                 style="background-color: ${isOverdue ? '#dc2626' : '#4f46e5'}; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                ${isOverdue ? 'Contact Us Urgently' : 'Contact Us'}
              </a>
            </div>
            
            <div style="border-top: 1px solid #e2e8f0; margin-top: 40px; padding-top: 30px; text-align: center;">
              <p style="color: #64748b; font-size: 14px; margin: 0 0 10px 0;">
                If you have already made payment, please ignore this reminder.
              </p>
              <p style="color: #64748b; font-size: 14px; margin: 0;">
                If you have any questions or need to discuss payment arrangements, please contact us directly.
              </p>
            </div>
          </div>
          
          <!-- Footer -->
          <div style="background-color: #f8fafc; padding: 30px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="color: #64748b; font-size: 12px; margin: 0 0 10px 0;">
              Cranbourne Public Hall Management System
            </p>
            <p style="color: #64748b; font-size: 12px; margin: 0;">
              Payment reminder sent on ${new Date().toLocaleDateString('en-AU')}
            </p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  async sendTestEmail(toEmail) {
    try {
      const testNotification = {
        type: 'booking_confirmed',
        title: 'Test Notification',
        message: 'This is a test email to verify the email notification system is working correctly.',
        data: {
          bookingId: 'TEST-123',
          eventType: 'Test Event',
          bookingDate: new Date().toLocaleDateString(),
          startTime: '10:00 AM',
          endTime: '2:00 PM',
          calculatedPrice: 150.00
        }
      };

      const result = await this.sendNotificationEmail(testNotification, toEmail);
      console.log('✅ Test email sent successfully to:', toEmail);
      return result;
    } catch (error) {
      console.error('❌ Test email failed:', error);
      throw error;
    }
  }
}

module.exports = new EmailService();
