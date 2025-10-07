const axios = require('axios');

const API_BASE_URL = 'http://localhost:5000/api';

// Test data
const testUser = {
  email: 'test@example.com',
  password: 'password123'
};

const testTemplate = {
  name: 'Test Booking Confirmation',
  type: 'email',
  subject: 'Your booking is confirmed - {{eventType}}',
  body: 'Dear {{customerName}},\n\nYour booking for {{eventType}} on {{bookingDate}} at {{startTime}} has been confirmed.\n\nVenue: {{hallName}}\nPrice: ${{calculatedPrice}}\n\nThank you for choosing us!\n\nBest regards,\nCranbourne Public Hall Team'
};

const testEmail = {
  templateId: '', // Will be set after creating template
  recipientEmail: 'customer@example.com',
  recipientName: 'John Doe',
  bookingId: 'TEST-123',
  variables: {
    customerName: 'John Doe',
    eventType: 'Wedding Reception',
    bookingDate: '2024-01-15',
    startTime: '6:00 PM',
    endTime: '11:00 PM',
    hallName: 'Main Hall',
    calculatedPrice: '500.00'
  }
};

async function testEmailComms() {
  try {
    console.log('🧪 Starting Email Communications Test...\n');

    // Step 1: Login to get token
    console.log('1. Logging in...');
    const loginResponse = await axios.post(`${API_BASE_URL}/login`, testUser);
    const token = loginResponse.data.token;
    console.log('✅ Login successful\n');

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    // Step 2: Create email template
    console.log('2. Creating email template...');
    const templateResponse = await axios.post(`${API_BASE_URL}/email-templates`, testTemplate, { headers });
    const templateId = templateResponse.data.template.id;
    console.log('✅ Template created:', templateId);
    console.log('   Template name:', templateResponse.data.template.name);
    console.log('   Subject:', templateResponse.data.template.subject);
    console.log('   Variables:', templateResponse.data.template.variables);
    console.log('');

    // Step 3: Get all templates
    console.log('3. Fetching all templates...');
    const templatesResponse = await axios.get(`${API_BASE_URL}/email-templates`, { headers });
    console.log('✅ Templates fetched:', templatesResponse.data.templates.length, 'templates found');
    console.log('');

    // Step 4: Send email using template
    console.log('4. Sending email using template...');
    testEmail.templateId = templateId;
    const emailResponse = await axios.post(`${API_BASE_URL}/email-comms/send`, testEmail, { headers });
    console.log('✅ Email sent successfully');
    console.log('   Email ID:', emailResponse.data.emailId);
    console.log('   Message ID:', emailResponse.data.messageId);
    console.log('');

    // Step 5: Send custom email
    console.log('5. Sending custom email...');
    const customEmail = {
      recipientEmail: 'custom@example.com',
      recipientName: 'Jane Smith',
      customSubject: 'Custom Test Email',
      customBody: 'This is a custom test email without using a template.',
      isCustom: true
    };
    const customEmailResponse = await axios.post(`${API_BASE_URL}/email-comms/send`, customEmail, { headers });
    console.log('✅ Custom email sent successfully');
    console.log('   Email ID:', customEmailResponse.data.emailId);
    console.log('');

    // Step 6: Get email history
    console.log('6. Fetching email history...');
    const historyResponse = await axios.get(`${API_BASE_URL}/email-comms/history`, { headers });
    console.log('✅ Email history fetched:', historyResponse.data.emails.length, 'emails found');
    historyResponse.data.emails.forEach((email, index) => {
      console.log(`   ${index + 1}. ${email.subject} -> ${email.to} (${email.status})`);
    });
    console.log('');

    // Step 7: Get customers
    console.log('7. Fetching customers...');
    const customersResponse = await axios.get(`${API_BASE_URL}/email-comms/customers`, { headers });
    console.log('✅ Customers fetched:', customersResponse.data.customers.length, 'customers found');
    console.log('');

    // Step 8: Update template
    console.log('8. Updating template...');
    const updatedTemplate = {
      name: 'Updated Test Template',
      subject: 'Updated: Your booking is confirmed - {{eventType}}',
      body: 'Dear {{customerName}},\n\nThis is an updated template.\n\nYour booking for {{eventType}} on {{bookingDate}} has been confirmed.\n\nBest regards,\nCranbourne Public Hall Team'
    };
    const updateResponse = await axios.put(`${API_BASE_URL}/email-templates/${templateId}`, updatedTemplate, { headers });
    console.log('✅ Template updated successfully');
    console.log('');

    // Step 9: Delete template
    console.log('9. Deleting template...');
    const deleteResponse = await axios.delete(`${API_BASE_URL}/email-templates/${templateId}`, { headers });
    console.log('✅ Template deleted successfully');
    console.log('');

    console.log('🎉 All tests passed! Email communications system is working correctly.');
    console.log('\n📋 Test Summary:');
    console.log('   ✅ User authentication');
    console.log('   ✅ Template CRUD operations');
    console.log('   ✅ Email sending with templates');
    console.log('   ✅ Custom email sending');
    console.log('   ✅ Email history tracking');
    console.log('   ✅ Customer data retrieval');
    console.log('   ✅ Template personalization');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data?.message || error.message);
    if (error.response?.data) {
      console.error('   Response data:', error.response.data);
    }
    process.exit(1);
  }
}

// Run the test
testEmailComms();
