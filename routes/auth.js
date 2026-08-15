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
// SEND PHONE OTP - ROBASE
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
      phone = '+234' + phone.substring(1);
    } else if (phone.startsWith('234')) {
      phone = '+' + phone;
    } else if (!phone.startsWith('+')) {
      phone = '+' + phone;
    }

    const response = await fetch(
      'https://api.robase.dev/v1/otp/send',
      {
        method: 'POST',

        headers: {
          'Authorization':
            `Bearer ${process.env.ROBASE_API_KEY}`,

          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          phone_number: phone,
          code_length: 6,
          ttl_seconds: 600
        })
      }
    );

    const data = await response.json();

    console.log(
      'Robase send OTP response:',
      data
    );

    if (!response.ok || !data.otp_id) {
      return res.status(400).json({
        success: false,
        message:
          data.message ||
          'Unable to send verification code.'
      });
    }

    return res.json({
      success: true,

      // Keep your existing app's pinId name
      pinId: data.otp_id
    });

  } catch (error) {

    console.error(
      'Robase send OTP error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Unable to send verification code.'
    });
  }
});

// =========================
// VERIFY PHONE OTP - ROBASE
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
      'https://api.robase.dev/v1/otp/verify',
      {
        method: 'POST',

        headers: {
          'Authorization':
            `Bearer ${process.env.ROBASE_API_KEY}`,

          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          otp_id: pinId,
          code: code
        })
      }
    );

    const data = await response.json();

    console.log(
      'Robase verify OTP response:',
      data
    );

    if (
      !response.ok ||
      data.verified !== true
    ) {

      return res.status(400).json({
        success: false,
        message:
          data.message ||
          'Invalid or expired verification code.'
      });
    }

    return res.json({
      success: true,
      message:
        'Phone number verified successfully.'
    });

  } catch (error) {

    console.error(
      'Robase verify OTP error:',
      error
    );

    return res.status(500).json({
      success: false,
      message:
        'Unable to verify phone number.'
    });
  }
});

module.exports = router;