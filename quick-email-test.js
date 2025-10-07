const nodemailer = require('nodemailer');

async function quickEmailTest() {
  console.log('🧪 Quick email test starting...');
  
  try {
    // Create transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'pawankanchana34741@gmail.com',
        pass: 'ijzu oxwl nuok hdxv'
      }
    });

    // Verify connection
    console.log('1️⃣ Verifying connection...');
    await transporter.verify();
    console.log('✅ Connection verified');

    // Send test email
    console.log('2️⃣ Sending test email...');
    const result = await transporter.sendMail({
      from: 'pawankanchana34741@gmail.com',
      to: 'pawankanchana34741@gmail.com',
      subject: 'Test Email - Cranbourne Hall Notifications',
      html: `
        <h1>Email Notification System Test</h1>
        <p>This is a test email to verify the notification system is working correctly.</p>
        <p><strong>Status:</strong> ✅ Email service is functional</p>
        <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
      `,
      text: 'Email notification system test - Status: Working correctly'
    });

    console.log('✅ Test email sent successfully!');
    console.log('📧 Message ID:', result.messageId);
    console.log('📧 Check your inbox for the test email');

  } catch (error) {
    console.error('❌ Email test failed:', error.message);
  }
}

quickEmailTest();
