const express = require('express');
const { Resend } = require('resend');
const { admin } = require('../firebaseAdmin');

const router = express.Router();

const resend = new Resend(process.env.RESEND_API_KEY);

router.post('/send-verification-email', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Generate Firebase verification link
    const actionCodeSettings = {
      url: "https://tunnelmouth.com/verify?verified=true",
      handleCodeInApp: false,
    };

    const verificationLink = 
      await admin.auth().generateEmailVerificationLink(
        email,
        actionCodeSettings
      );

    // Send email
    await resend.emails.send({
      from: 'TunnelMouth <noreply@tunnelmouth.com>',
      to: email,
      subject: 'Verify your TunnelMouth account',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:30px;">
          <h2>Welcome to TunnelMouth</h2>

          <p>
            Thank you for creating your account.
          </p>

          <p>
            Please verify your email address by clicking the button below.
          </p>

          <p style="margin:40px 0;">
            <a
              href="${verificationLink}"
              style="
                background:#04B559;
                color:#fff;
                text-decoration:none;
                padding:14px 28px;
                border-radius:8px;
                display:inline-block;
                font-weight:bold;
              "
            >
              Verify Email
            </a>
          </p>

          <p>
            If you did not create this account, you can safely ignore this email.
          </p>

          <hr>

          <small>
            © TunnelMouth Technologies Limited
          </small>
        </div>
      `
    });

    return res.json({
      success: true
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      success: false,
      message: err.message
    });

  }
});

router.post('/send-password-reset-email', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    const resetLink =
      await admin.auth().generatePasswordResetLink(email);

    await resend.emails.send({
      from: 'TunnelMouth <noreply@tunnelmouth.com>',
      to: email,
      subject: 'Reset your TunnelMouth password',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:30px;">
          <h2>Reset your TunnelMouth password</h2>

          <p>
            We received a request to reset the password for your TunnelMouth account.
          </p>

          <p>
            Click the button below to create a new password.
          </p>

          <p style="margin:40px 0;">
            <a
              href="${resetLink}"
              style="
                background:#04B559;
                color:#fff;
                text-decoration:none;
                padding:14px 28px;
                border-radius:8px;
                display:inline-block;
                font-weight:bold;
              "
            >
              Reset Password
            </a>
          </p>

          <p>
            If you didn't request a password reset, you can safely ignore this email.
            Your password will remain unchanged.
          </p>

          <hr>

          <small>
            © TunnelMouth Technologies Limited
          </small>
        </div>
      `
    });

    return res.json({
      success: true
    });

  } catch (err) {

    console.error(err);

    return res.status(500).json({
      success: false,
      message: err.message
    });

  }
});

// =========================
// SEND PHONE OTP
// =========================

router.post('/send-phone-otp', async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // Convert Nigerian number to international format
    let phone = phoneNumber.trim();

    if (phone.startsWith('0')) {
      phone = '234' + phone.substring(1);
    }

    if (phone.startsWith('+')) {
      phone = phone.substring(1);
    }

    const response = await fetch(
      `${process.env.TERMII_BASE_URL || 'https://v4.api.termii.com'}/api/sms/otp/send`,
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          api_key: process.env.TERMII_API_KEY,

          message_type: 'NUMERIC',

          to: phone,

          from: 'TunnelMouth',

          channel: 'generic',

          pin_attempts: 3,

          pin_time_to_live: 5,

          pin_length: 6,

          pin_placeholder: '< 123456 >',

          message_text:
            'Your TunnelMouth verification code is < 123456 >',

          pin_type: 'NUMERIC'
        })
      }
    );

    const data = await response.json();

    console.log('Termii send OTP response:', data);

    if (!response.ok || !data.pinId && !data.pin_id) {
      return res.status(400).json({
        success: false,
        message:
          data.message ||
          'Unable to send verification code.'
      });
    }

    return res.json({
      success: true,

      // Termii may return either format depending on API response
      pinId: data.pinId || data.pin_id
    });

  } catch (error) {

    console.error('Termii send OTP error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to send verification code.'
    });
  }
});


// =========================
// VERIFY PHONE OTP
// =========================

router.post('/verify-phone-otp', async (req, res) => {
  try {

    const { pinId, code } = req.body;

    if (!pinId || !code) {
      return res.status(400).json({
        success: false,
        message: 'Verification code is required'
      });
    }

    const response = await fetch(
      `${process.env.TERMII_BASE_URL || 'https://v4.api.termii.com'}/api/sms/otp/verify`,
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          api_key: process.env.TERMII_API_KEY,

          pin_id: pinId,

          pin: code
        })
      }
    );

    const data = await response.json();

    console.log('Termii verify OTP response:', data);

    if (!response.ok) {
      return res.status(400).json({
        success: false,
        message:
          data.message ||
          'Invalid verification code.'
      });
    }

    return res.json({
      success: true,
      message: 'Phone number verified successfully.'
    });

  } catch (error) {

    console.error('Termii verify OTP error:', error);

    return res.status(500).json({
      success: false,
      message: 'Unable to verify phone number.'
    });
  }
});

module.exports = router;