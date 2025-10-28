const admin = require('../firebaseAdmin');

class AuditService {
  /**
   * Get the appropriate hallId for a user based on their role
   * @param {Object} userData - User data object
   * @param {string} userData.role - User role
   * @param {string} userData.hallId - Direct hall ID (if available)
   * @param {string} userData.parentUserId - Parent user ID (for sub-users)
   * @param {string} userId - User ID (for hall owners)
   * @returns {string|null} - The appropriate hallId
   */
  static getHallId(userData, userId = null) {
    // If user has direct hallId, use it
    if (userData.hallId) {
      return userData.hallId;
    }
    
    // For hall owners, use their own ID as hallId
    if (userData.role === 'hall_owner' && userId) {
      return userId;
    }
    
    // For sub-users, use their parent's ID as hallId
    if (userData.role === 'sub_user' && userData.parentUserId) {
      return userData.parentUserId;
    }
    
    return null;
  }

  /**
   * Log an audit event
   * @param {Object} params - Audit log parameters
   * @param {string} params.userId - ID of the user performing the action
   * @param {string} params.userEmail - Email of the user performing the action
   * @param {string} params.userRole - Role of the user performing the action
   * @param {string} params.action - Action being performed (e.g., 'user_created', 'booking_updated')
   * @param {string} params.targetType - Type of object being acted upon (e.g., 'user', 'booking', 'hall')
   * @param {string} params.target - Description of the target object
   * @param {Object} params.changes - Object containing old and new values
   * @param {string} params.ipAddress - IP address of the user
   * @param {string} params.hallId - ID of the hall (for hall owners and sub-users)
   * @param {string} params.additionalInfo - Additional information about the action
   */
  static async logEvent({
    userId,
    userEmail,
    userRole,
    action,
    targetType,
    target,
    changes = {},
    ipAddress,
    hallId,
    additionalInfo = ''
  }) {
    try {
      const auditLog = {
        userId,
        userEmail,
        userRole,
        action,
        targetType,
        target,
        changes,
        ipAddress,
        hallId,
        additionalInfo,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      };

      // Remove undefined values
      Object.keys(auditLog).forEach(key => {
        if (auditLog[key] === undefined) {
          delete auditLog[key];
        }
      });

      await admin.firestore().collection('audit_logs').add(auditLog);
      console.log('Audit log created:', { action, userEmail, target });
    } catch (error) {
      console.error('Error creating audit log:', error);
      // Don't throw error to prevent breaking the main operation
    }
  }

  /**
   * Log user authentication events
   */
  static async logUserLogin(userId, userEmail, userRole, ipAddress, hallId = null) {
    await this.logEvent({
      userId,
      userEmail,
      userRole,
      action: 'user_login',
      targetType: 'user',
      target: `User: ${userEmail}`,
      ipAddress,
      hallId,
      additionalInfo: 'User successfully logged in'
    });
  }

  static async logUserLogout(userId, userEmail, userRole, ipAddress, hallId = null) {
    await this.logEvent({
      userId,
      userEmail,
      userRole,
      action: 'user_logout',
      targetType: 'user',
      target: `User: ${userEmail}`,
      ipAddress,
      hallId,
      additionalInfo: 'User logged out'
    });
  }

  static async logPasswordChanged(userId, userEmail, userRole, ipAddress, hallId = null) {
    await this.logEvent({
      userId,
      userEmail,
      userRole,
      action: 'password_changed',
      targetType: 'user',
      target: `User: ${userEmail}`,
      ipAddress,
      hallId,
      additionalInfo: 'User changed their password'
    });
  }

  static async logSubUserPasswordChanged(hallOwnerId, hallOwnerEmail, hallOwnerRole, subUserData, ipAddress, hallId) {
    await this.logEvent({
      userId: hallOwnerId,
      userEmail: hallOwnerEmail,
      userRole: hallOwnerRole,
      action: 'sub_user_password_changed',
      targetType: 'user',
      target: `Sub-User: ${subUserData.email}`,
      changes: {
        new: {
          subUserId: subUserData.id,
          subUserEmail: subUserData.email,
          subUserName: subUserData.name || 'No name'
        }
      },
      ipAddress,
      hallId,
      additionalInfo: `Hall owner changed password for sub-user: ${subUserData.name || subUserData.email}`
    });
  }

  /**
   * Log user management events
   */
  static async logUserCreated(creatorId, creatorEmail, creatorRole, newUser, ipAddress, hallId = null) {
    await this.logEvent({
      userId: creatorId,
      userEmail: creatorEmail,
      userRole: creatorRole,
      action: 'user_created',
      targetType: 'user',
      target: `User: ${newUser.email}`,
      changes: {
        new: {
          email: newUser.email,
          role: newUser.role,
          name: newUser.name || '',
          hallName: newUser.hallName || ''
        }
      },
      ipAddress,
      hallId,
      additionalInfo: `Created ${newUser.role} user`
    });
  }

  static async logUserUpdated(updaterId, updaterEmail, updaterRole, oldUser, newUser, ipAddress, hallId = null) {
    const changes = {};
    
    // Compare old and new values
    const fieldsToCompare = ['email', 'role', 'name', 'hallName', 'contactNumber', 'address', 'permissions', 'status'];
    
    fieldsToCompare.forEach(field => {
      if (JSON.stringify(oldUser[field]) !== JSON.stringify(newUser[field])) {
        changes[field] = {
          old: oldUser[field],
          new: newUser[field]
        };
      }
    });

    if (Object.keys(changes).length > 0) {
      await this.logEvent({
        userId: updaterId,
        userEmail: updaterEmail,
        userRole: updaterRole,
        action: 'user_updated',
        targetType: 'user',
        target: `User: ${newUser.email}`,
        changes,
        ipAddress,
        hallId,
        additionalInfo: `Updated ${newUser.role} user`
      });
    }
  }

  static async logUserDeleted(deleterId, deleterEmail, deleterRole, deletedUser, ipAddress, hallId = null) {
    await this.logEvent({
      userId: deleterId,
      userEmail: deleterEmail,
      userRole: deleterRole,
      action: 'user_deleted',
      targetType: 'user',
      target: `User: ${deletedUser.email}`,
      changes: {
        old: {
          email: deletedUser.email,
          role: deletedUser.role,
          name: deletedUser.name || '',
          hallName: deletedUser.hallName || ''
        }
      },
      ipAddress,
      hallId,
      additionalInfo: `Deleted ${deletedUser.role} user`
    });
  }

  /**
   * Log booking events
   */
  static async logBookingCreated(creatorId, creatorEmail, creatorRole, booking, ipAddress, hallId) {
    await this.logEvent({
      userId: creatorId,
      userEmail: creatorEmail,
      userRole: creatorRole,
      action: 'booking_created',
      targetType: 'booking',
      target: `Booking ID: ${booking.id}`,
      changes: {
        new: {
          customerName: booking.customerName,
          eventDate: booking.eventDate,
          status: booking.status,
          totalAmount: booking.totalAmount
        }
      },
      ipAddress,
      hallId,
      additionalInfo: `Created booking for ${booking.customerName}`
    });
  }

  static async logBookingUpdated(updaterId, updaterEmail, updaterRole, oldBooking, newBooking, ipAddress, hallId) {
    const oldId = oldBooking?.id || oldBooking?.bookingId;
    const newId = newBooking?.id || newBooking?.bookingId || oldId;
    const changes = {};
    
    const fieldsToCompare = ['status', 'customerName', 'eventDate', 'totalAmount', 'notes'];
    
    fieldsToCompare.forEach(field => {
      if (JSON.stringify(oldBooking[field]) !== JSON.stringify(newBooking[field])) {
        changes[field] = {
          old: oldBooking[field],
          new: newBooking[field]
        };
      }
    });

    if (Object.keys(changes).length > 0) {
      await this.logEvent({
        userId: updaterId,
        userEmail: updaterEmail,
        userRole: updaterRole,
        action: 'booking_updated',
        targetType: 'booking',
        target: `Booking ID: ${newId}`,
        changes,
        ipAddress,
        hallId,
        additionalInfo: `Updated booking for ${newBooking.customerName}`
      });
    }
  }

  static async logBookingCancelled(cancellerId, cancellerEmail, cancellerRole, booking, reason, ipAddress, hallId) {
    const bookingId = booking?.id || booking?.bookingId;
    await this.logEvent({
      userId: cancellerId,
      userEmail: cancellerEmail,
      userRole: cancellerRole,
      action: 'booking_cancelled',
      targetType: 'booking',
      target: `Booking ID: ${bookingId}`,
      changes: {
        old: { status: booking.status },
        new: { status: 'cancelled' }
      },
      ipAddress,
      hallId,
      additionalInfo: `Cancelled booking: ${reason || 'No reason provided'}`
    });
  }

  static async logBookingConfirmed(confirmerId, confirmerEmail, confirmerRole, booking, ipAddress, hallId) {
    const bookingId = booking?.id || booking?.bookingId;
    await this.logEvent({
      userId: confirmerId,
      userEmail: confirmerEmail,
      userRole: confirmerRole,
      action: 'booking_confirmed',
      targetType: 'booking',
      target: `Booking ID: ${bookingId}`,
      changes: {
        old: { status: booking.status },
        new: { status: 'confirmed' }
      },
      ipAddress,
      hallId,
      additionalInfo: `Confirmed booking for ${booking.customerName}`
    });
  }

  /**
   * Log quotation events
   */
  static async logQuotationCreated(creatorId, creatorEmail, creatorRole, quotation, ipAddress, hallId) {
    await this.logEvent({
      userId: creatorId,
      userEmail: creatorEmail,
      userRole: creatorRole,
      action: 'quotation_created',
      targetType: 'quotation',
      target: `Quotation ID: ${quotation.quotationId}`,
      changes: {
        new: {
          customerName: quotation.customerName,
          eventType: quotation.eventType,
          totalAmount: quotation.totalAmount,
          status: 'Draft'
        }
      },
      ipAddress,
      hallId,
      additionalInfo: `Created quotation for ${quotation.customerName}`
    });
  }

  static async logQuotationUpdated(updaterId, updaterEmail, updaterRole, oldQuotation, newQuotation, ipAddress, hallId) {
    const changes = {};
    
    const fieldsToCompare = ['status', 'customerName', 'eventType', 'totalAmount', 'notes'];
    
    fieldsToCompare.forEach(field => {
      if (JSON.stringify(oldQuotation[field]) !== JSON.stringify(newQuotation[field])) {
        changes[field] = {
          old: oldQuotation[field],
          new: newQuotation[field]
        };
      }
    });

    if (Object.keys(changes).length > 0) {
      await this.logEvent({
        userId: updaterId,
        userEmail: updaterEmail,
        userRole: updaterRole,
        action: 'quotation_updated',
        targetType: 'quotation',
        target: `Quotation ID: ${newQuotation.id}`,
        changes,
        ipAddress,
        hallId,
        additionalInfo: `Updated quotation for ${newQuotation.customerName}`
      });
    }
  }

  static async logQuotationStatusChanged(updaterId, updaterEmail, updaterRole, quotation, oldStatus, newStatus, ipAddress, hallId) {
    await this.logEvent({
      userId: updaterId,
      userEmail: updaterEmail,
      userRole: updaterRole,
      action: 'quotation_status_changed',
      targetType: 'quotation',
      target: `Quotation ID: ${quotation.id}`,
      changes: {
        old: { status: oldStatus },
        new: { status: newStatus }
      },
      ipAddress,
      hallId,
      additionalInfo: `Changed quotation status from ${oldStatus} to ${newStatus} for ${quotation.customerName}`
    });
  }

  static async logQuotationDeleted(deleterId, deleterEmail, deleterRole, quotation, ipAddress, hallId) {
    await this.logEvent({
      userId: deleterId,
      userEmail: deleterEmail,
      userRole: deleterRole,
      action: 'quotation_deleted',
      targetType: 'quotation',
      target: `Quotation ID: ${quotation.id}`,
      changes: {
        old: {
          customerName: quotation.customerName,
          eventType: quotation.eventType,
          totalAmount: quotation.totalAmount,
          status: quotation.status
        }
      },
      ipAddress,
      hallId,
      additionalInfo: `Deleted quotation for ${quotation.customerName}`
    });
  }

  /**
   * Log hall/settings events
   */
  static async logHallSettingsUpdated(updaterId, updaterEmail, updaterRole, oldSettings, newSettings, ipAddress, hallId) {
    const changes = {};
    
    const fieldsToCompare = ['hallName', 'contactNumber', 'address', 'status'];
    
    fieldsToCompare.forEach(field => {
      if (JSON.stringify(oldSettings[field]) !== JSON.stringify(newSettings[field])) {
        changes[field] = {
          old: oldSettings[field],
          new: newSettings[field]
        };
      }
    });

    if (Object.keys(changes).length > 0) {
      await this.logEvent({
        userId: updaterId,
        userEmail: updaterEmail,
        userRole: updaterRole,
        action: 'hall_settings_updated',
        targetType: 'hall',
        target: `Hall: ${newSettings.hallName || 'Unknown'}`,
        changes,
        ipAddress,
        hallId,
        additionalInfo: 'Updated hall settings'
      });
    }
  }

  /**
   * Log user settings update
   */
  static async logSettingsUpdated(updaterId, updaterEmail, updaterRole, settings, ipAddress, hallId) {
    const changes = {};
    
    const fieldsToCompare = ['timezone', 'dateFormat', 'timeFormat', 'currency'];
    
    fieldsToCompare.forEach(field => {
      if (settings[field] !== null && settings[field] !== undefined) {
        changes[field] = {
          new: settings[field]
        };
      }
    });

    if (Object.keys(changes).length > 0) {
      await this.logEvent({
        userId: updaterId,
        userEmail: updaterEmail,
        userRole: updaterRole,
        action: 'settings_updated',
        targetType: 'user',
        target: 'User Settings',
        changes,
        ipAddress,
        hallId,
        additionalInfo: 'Updated user preferences'
      });
    }
  }

  /**
   * Log pricing events
   */
  static async logPricingUpdated(updaterId, updaterEmail, updaterRole, oldPricing, newPricing, ipAddress, hallId) {
    const changes = {};
    
    const fieldsToCompare = ['baseRate', 'peakRate', 'weekendRate', 'addonRates'];
    
    fieldsToCompare.forEach(field => {
      if (JSON.stringify(oldPricing[field]) !== JSON.stringify(newPricing[field])) {
        changes[field] = {
          old: oldPricing[field],
          new: newPricing[field]
        };
      }
    });

    if (Object.keys(changes).length > 0) {
      await this.logEvent({
        userId: updaterId,
        userEmail: updaterEmail,
        userRole: updaterRole,
        action: 'pricing_updated',
        targetType: 'pricing',
        target: 'Hall Pricing',
        changes,
        ipAddress,
        hallId,
        additionalInfo: 'Updated pricing rates'
      });
    }
  }

  /**
   * Log resource events
   */
  static async logResourceCreated(creatorId, creatorEmail, creatorRole, resource, ipAddress, hallId) {
    await this.logEvent({
      userId: creatorId,
      userEmail: creatorEmail,
      userRole: creatorRole,
      action: 'resource_created',
      targetType: 'resource',
      target: `Resource: ${resource.name}`,
      changes: {
        new: {
          name: resource.name,
          type: resource.type,
          capacity: resource.capacity,
          status: resource.status
        }
      },
      ipAddress,
      hallId,
      additionalInfo: `Created ${resource.type} resource`
    });
  }

  static async logResourceUpdated(updaterId, updaterEmail, updaterRole, oldResource, newResource, ipAddress, hallId) {
    const changes = {};
    
    const fieldsToCompare = ['name', 'type', 'capacity', 'status', 'description'];
    
    fieldsToCompare.forEach(field => {
      if (JSON.stringify(oldResource[field]) !== JSON.stringify(newResource[field])) {
        changes[field] = {
          old: oldResource[field],
          new: newResource[field]
        };
      }
    });

    if (Object.keys(changes).length > 0) {
      await this.logEvent({
        userId: updaterId,
        userEmail: updaterEmail,
        userRole: updaterRole,
        action: 'resource_updated',
        targetType: 'resource',
        target: `Resource: ${newResource.name}`,
        changes,
        ipAddress,
        hallId,
        additionalInfo: `Updated ${newResource.type} resource`
      });
    }
  }

  static async logResourceDeleted(deleterId, deleterEmail, deleterRole, resource, ipAddress, hallId) {
    await this.logEvent({
      userId: deleterId,
      userEmail: deleterEmail,
      userRole: deleterRole,
      action: 'resource_deleted',
      targetType: 'resource',
      target: `Resource: ${resource.name}`,
      changes: {
        old: {
          name: resource.name,
          type: resource.type,
          capacity: resource.capacity,
          status: resource.status
        }
      },
      ipAddress,
      hallId,
      additionalInfo: `Deleted ${resource.type} resource`
    });
  }

  /**
   * Log system events
   */
  static async logSystemConfigChanged(changerId, changerEmail, changerRole, oldConfig, newConfig, ipAddress, hallId = null) {
    const changes = {};
    
    Object.keys(newConfig).forEach(key => {
      if (JSON.stringify(oldConfig[key]) !== JSON.stringify(newConfig[key])) {
        changes[key] = {
          old: oldConfig[key],
          new: newConfig[key]
        };
      }
    });

    if (Object.keys(changes).length > 0) {
      await this.logEvent({
        userId: changerId,
        userEmail: changerEmail,
        userRole: changerRole,
        action: 'system_config_changed',
        targetType: 'system',
        target: 'System Configuration',
        changes,
        ipAddress,
        hallId,
        additionalInfo: 'Updated system configuration'
      });
    }
  }

  /**
   * Log report generation
   */
  static async logReportGenerated(generatorId, generatorEmail, generatorRole, reportType, reportParams, ipAddress, hallId) {
    await this.logEvent({
      userId: generatorId,
      userEmail: generatorEmail,
      userRole: generatorRole,
      action: 'report_generated',
      targetType: 'report',
      target: `Report: ${reportType}`,
      changes: {
        new: {
          reportType,
          parameters: reportParams
        }
      },
      ipAddress,
      hallId,
      additionalInfo: `Generated ${reportType} report`
    });
  }

  // Invoice audit methods
  static async logInvoiceCreated(creatorId, creatorEmail, creatorRole, invoice, ipAddress, hallId) {
    await this.logEvent({
      userId: creatorId,
      userEmail: creatorEmail,
      userRole: creatorRole,
      action: 'invoice_created',
      targetType: 'invoice',
      target: `Invoice: ${invoice.invoiceNumber}`,
      changes: {
        new: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          bookingId: invoice.bookingId,
          invoiceType: invoice.invoiceType,
          total: invoice.total
        }
      },
      ipAddress,
      hallId,
      additionalInfo: `Created ${invoice.invoiceType} invoice for booking ${invoice.bookingId}`
    });
  }

  static async logInvoiceUpdated(updaterId, updaterEmail, updaterRole, oldInvoice, newInvoice, ipAddress, hallId) {
    await this.logEvent({
      userId: updaterId,
      userEmail: updaterEmail,
      userRole: updaterRole,
      action: 'invoice_updated',
      targetType: 'invoice',
      target: `Invoice: ${newInvoice.invoiceNumber || oldInvoice.invoiceNumber}`,
      changes: {
        old: {
          status: oldInvoice.status,
          paidAmount: oldInvoice.paidAmount
        },
        new: {
          status: newInvoice.status,
          paidAmount: newInvoice.paidAmount
        }
      },
      ipAddress,
      hallId,
      additionalInfo: `Updated invoice status from ${oldInvoice.status} to ${newInvoice.status}`
    });
  }

  // Payment audit methods
  static async logPaymentRecorded(recorderId, recorderEmail, recorderRole, payment, ipAddress, hallId) {
    await this.logEvent({
      userId: recorderId,
      userEmail: recorderEmail,
      userRole: recorderRole,
      action: 'payment_recorded',
      targetType: 'payment',
      target: `Payment: ${payment.id}`,
      changes: {
        new: {
          paymentId: payment.id,
          invoiceId: payment.invoiceId,
          invoiceNumber: payment.invoiceNumber,
          amount: payment.amount,
          paymentMethod: payment.paymentMethod
        }
      },
      ipAddress,
      hallId,
      additionalInfo: `Recorded ${payment.paymentMethod} payment of $${payment.amount} for invoice ${payment.invoiceNumber}`
    });
  }

  static async logPaymentUpdated(updaterId, updaterEmail, updaterRole, oldPayment, newPayment, ipAddress, hallId) {
    await this.logEvent({
      userId: updaterId,
      userEmail: updaterEmail,
      userRole: updaterRole,
      action: 'payment_updated',
      targetType: 'payment',
      target: `Payment: ${newPayment.id || oldPayment.id}`,
      changes: {
        old: {
          paymentMethod: oldPayment.paymentMethod,
          reference: oldPayment.reference,
          notes: oldPayment.notes
        },
        new: {
          paymentMethod: newPayment.paymentMethod,
          reference: newPayment.reference,
          notes: newPayment.notes
        }
      },
      ipAddress,
      hallId,
      additionalInfo: `Updated payment details for payment ${newPayment.id || oldPayment.id}`
    });
  }

  static async logPaymentDeleted(deleterId, deleterEmail, deleterRole, payment, ipAddress, hallId) {
    await this.logEvent({
      userId: deleterId,
      userEmail: deleterEmail,
      userRole: deleterRole,
      action: 'payment_deleted',
      targetType: 'payment',
      target: `Payment: ${payment.id}`,
      changes: {
        old: {
          paymentId: payment.id,
          invoiceId: payment.invoiceId,
          invoiceNumber: payment.invoiceNumber,
          amount: payment.amount,
          paymentMethod: payment.paymentMethod
        }
      },
      ipAddress,
      hallId,
      additionalInfo: `Deleted payment of $${payment.amount} for invoice ${payment.invoiceNumber}`
    });
  }

  /**
   * Log when a booking's deposit paid status is toggled
   */
  static async logBookingDepositStatusChanged(userId, userEmail, userRole, booking, wasPaid, isPaid, amount, ipAddress, hallId) {
    const action = isPaid ? 'deposit_marked_paid' : 'deposit_marked_unpaid';
    const bookingId = booking?.id || booking?.bookingId;
    const bookingCode = booking?.bookingCode;
    const targetLabel = bookingCode ? `Booking ${bookingCode}` : `Booking ID: ${bookingId}`;
    await this.logEvent({
      userId,
      userEmail,
      userRole,
      action,
      targetType: 'booking',
      target: targetLabel,
      changes: {
        deposit_paid: { old: Boolean(wasPaid), new: Boolean(isPaid) },
        deposit_amount: amount
      },
      ipAddress,
      hallId,
      additionalInfo: `${isPaid ? 'Marked' : 'Unmarked'} deposit ${isPaid ? 'paid' : 'unpaid'} for ${targetLabel} (amount $${Number(amount || 0).toFixed(2)})`
    });
  }

  /**
   * Log when a quotation's deposit paid status is toggled
   */
  static async logQuotationDepositStatusChanged(userId, userEmail, userRole, quotation, wasPaid, isPaid, amount, ipAddress, hallId) {
    const action = isPaid ? 'deposit_marked_paid' : 'deposit_marked_unpaid';
    const quotationId = quotation?.id || quotation?.quotationId;
    await this.logEvent({
      userId,
      userEmail,
      userRole,
      action,
      targetType: 'quotation',
      target: `Quotation ID: ${quotationId}`,
      changes: {
        deposit_paid: { old: Boolean(wasPaid), new: Boolean(isPaid) },
        deposit_amount: amount
      },
      ipAddress,
      hallId,
      additionalInfo: `${isPaid ? 'Marked' : 'Unmarked'} deposit ${isPaid ? 'paid' : 'unpaid'} for quotation ${quotationId} (amount $${Number(amount || 0).toFixed(2)})`
    });
  }

  static async logProfilePictureUpdated(userId, userEmail, userRole, profilePictureUrl, ipAddress, hallId) {
    await this.logEvent({
      userId,
      userEmail,
      userRole,
      action: 'profile_picture_updated',
      targetType: 'user',
      target: `User: ${userEmail}`,
      changes: {
        new: {
          profilePicture: profilePictureUrl
        }
      },
      ipAddress,
      hallId,
      additionalInfo: `Profile picture updated for user ${userEmail}`
    });
  }

  static async logProfilePictureDeleted(userId, userEmail, userRole, ipAddress, hallId) {
    await this.logEvent({
      userId,
      userEmail,
      userRole,
      action: 'profile_picture_deleted',
      targetType: 'user',
      target: `User: ${userEmail}`,
      changes: {
        old: {
          profilePicture: 'deleted'
        }
      },
      ipAddress,
      hallId,
      additionalInfo: `Profile picture deleted for user ${userEmail}`
    });
  }

  /**
   * Log when invoice reminders are sent
   */
  static async logInvoiceRemindersSent(userId, userEmail, userRole, reminderData, ipAddress, hallId) {
    return this.logEvent({
      userId,
      userEmail,
      userRole,
      action: 'invoice_reminders_sent',
      targetType: 'invoice_reminders',
      target: `Payment reminders sent for ${reminderData.sentCount} invoice(s)`,
      changes: {
        invoiceIds: reminderData.invoiceIds,
        sentCount: reminderData.sentCount,
        failedCount: reminderData.failedCount,
        totalRequested: reminderData.totalRequested
      },
      ipAddress,
      hallId,
      additionalInfo: `Sent ${reminderData.sentCount} payment reminders out of ${reminderData.totalRequested} requested. ${reminderData.failedCount} failed.`
    });
  }
}

module.exports = AuditService;
