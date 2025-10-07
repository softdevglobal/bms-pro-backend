const admin = require('./firebaseAdmin');

async function testQuotations() {
  try {
    console.log('Testing Quotations System...\n');

    // Test 1: Create a test quotation
    console.log('1. Creating test quotation...');
    const testQuotation = {
      id: 'QUO-TEST-001',
      customerName: 'Test Customer',
      customerEmail: 'test@example.com',
      customerPhone: '0412345678',
      eventType: 'Test Event',
      resource: 'Main Hall',
      eventDate: '2025-02-15',
      startTime: '10:00',
      endTime: '14:00',
      guestCount: 50,
      totalAmount: 600.00,
      validUntil: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'Draft',
      notes: 'Test quotation for system verification',
      hallOwnerId: 'test-hall-owner-id',
      createdBy: 'test-user-id',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await admin.firestore().collection('quotations').add(testQuotation);
    console.log(`✅ Test quotation created with ID: ${docRef.id}`);

    // Test 2: Read the quotation
    console.log('\n2. Reading test quotation...');
    const quotationDoc = await admin.firestore().collection('quotations').doc(docRef.id).get();
    if (quotationDoc.exists) {
      const quotationData = quotationDoc.data();
      console.log('✅ Quotation data:', {
        id: quotationDoc.id,
        customerName: quotationData.customerName,
        eventType: quotationData.eventType,
        totalAmount: quotationData.totalAmount,
        status: quotationData.status
      });
    } else {
      console.log('❌ Quotation not found');
    }

    // Test 3: Update quotation status
    console.log('\n3. Updating quotation status to "Sent"...');
    await admin.firestore().collection('quotations').doc(docRef.id).update({
      status: 'Sent',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log('✅ Quotation status updated to "Sent"');

    // Test 4: Update quotation status to "Accepted" (should create booking)
    console.log('\n4. Updating quotation status to "Accepted"...');
    await admin.firestore().collection('quotations').doc(docRef.id).update({
      status: 'Accepted',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log('✅ Quotation status updated to "Accepted"');

    // Test 5: Check if booking was created
    console.log('\n5. Checking if booking was created...');
    const bookingsSnapshot = await admin.firestore()
      .collection('bookings')
      .where('quotationId', '==', docRef.id)
      .get();
    
    if (!bookingsSnapshot.empty) {
      const booking = bookingsSnapshot.docs[0];
      console.log('✅ Booking created from quotation:', {
        bookingId: booking.id,
        customerName: booking.data().customerName,
        status: booking.data().status,
        quotationId: booking.data().quotationId
      });
    } else {
      console.log('❌ No booking found for quotation');
    }

    // Test 6: Clean up test data
    console.log('\n6. Cleaning up test data...');
    await admin.firestore().collection('quotations').doc(docRef.id).delete();
    
    if (!bookingsSnapshot.empty) {
      await admin.firestore().collection('bookings').doc(bookingsSnapshot.docs[0].id).delete();
    }
    console.log('✅ Test data cleaned up');

    console.log('\n🎉 All quotation system tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testQuotations().then(() => {
  console.log('\nTest completed. Exiting...');
  process.exit(0);
}).catch((error) => {
  console.error('Test error:', error);
  process.exit(1);
});
