const express = require('express');
const admin = require('../firebaseAdmin');
const EmailService = require('../services/emailService');

const router = express.Router();

// POST /api/password/forgot
// Generates a Firebase password reset link and emails it to the user
router.post('/password/forgot', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ message: 'Valid email is required' });
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const actionCodeSettings = {
      url: `${frontendUrl}/reset-password`,
      handleCodeInApp: true
    };

    // Will throw if email does not exist
    const link = await admin.auth().generatePasswordResetLink(email.trim(), actionCodeSettings);
    // Extract oobCode from the generated link and build a direct app URL
    const urlObj = new URL(link);
    const oobCode = urlObj.searchParams.get('oobCode') || '';
    const lang = urlObj.searchParams.get('lang') || 'en';
    // Include both query and hash with the code to survive email client/link proxy rewriting
    const base = `${frontendUrl.replace(/\/+$/, '')}/reset-password`;
    const appLink = `${base}?oobCode=${encodeURIComponent(oobCode)}&lang=${encodeURIComponent(lang)}#oobCode=${encodeURIComponent(oobCode)}&lang=${encodeURIComponent(lang)}`;

    // Compose email with matching "from" address for transporter to avoid rejection
    const subject = 'Reset your BMSPRO password';
    const fromAddress = process.env.EMAIL_FROM
      || (EmailService?.transporter?.options?.auth?.user)
      || 'no-reply@bmspro.local';
    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: Arial, sans-serif; background:#f8fafc; padding:24px;">
        <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:20px;">
          <p style="color:#111827;">You requested to reset your password for <strong>${email.trim()}</strong>.</p>
          <p style="margin:16px 0;color:#374151;">Click the button below to set a new password:</p>
          <p style="text-align:center;margin:24px 0;">
            <a href="${appLink}" style="background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block;">Reset Password</a>
          </p>
          <p style="color:#6b7280;font-size:12px;margin-top:24px;">If you did not request this, you can safely ignore this email.</p>
        </div>
      </body>
      </html>
    `;
    const text = `You requested to reset your password.\n\nClick the "Reset Password" button in this email to set a new password.\n\nIf you did not request this, ignore this email.`;

    try {
      await EmailService.transporter.sendMail({
        from: fromAddress,
        to: email.trim(),
        subject,
        html,
        text
      });
      console.log('[ForgotPassword] Sent reset email to', email.trim(), 'from', fromAddress);
    } catch (sendErr) {
      console.error('[ForgotPassword] Email send failed:', sendErr?.message || sendErr);
      // As a fallback, still return success (do not disclose existence) but include dev info
      if (process.env.NODE_ENV !== 'production') {
        return res.json({ message: 'Password reset link generated (email send failed in dev).', devLink: appLink });
      }
      return res.json({ message: 'Password reset email sent if the account exists' });
    }

    return res.json({ message: 'Password reset email sent' });
  } catch (err) {
    // Normalize common Firebase errors
    if (err?.code === 'auth/user-not-found') {
      // For security, do not reveal whether the email exists
      return res.json({ message: 'Password reset email sent if the account exists' });
    }
    console.error('Forgot password error:', err);
    return res.status(500).json({ message: 'Failed to send password reset email' });
  }
});

module.exports = router;


