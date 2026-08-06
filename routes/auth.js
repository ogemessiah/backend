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
    const verificationLink =
      await admin.auth().generateEmailVerificationLink(email);

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
                background:#2563eb;
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



module.exports = router;