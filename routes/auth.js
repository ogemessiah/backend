const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

const { Resend } = require('resend');
const { admin } = require('../firebaseAdmin');

const router = express.Router();

const resend = new Resend(
  process.env.RESEND_API_KEY
);

const db = admin.firestore();


// =====================================================
// HELPERS
// =====================================================

function cleanEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function cleanPhoneNumber(phoneNumber) {
  let phone = String(phoneNumber || '').trim();

  if (phone.startsWith('0')) {
    phone = '+234' + phone.substring(1);
  } else if (phone.startsWith('234')) {
    phone = '+' + phone;
  } else if (!phone.startsWith('+')) {
    phone = '+' + phone;
  }

  return phone;
}


// Hash sensitive identifiers before storing them
// in Firestore as document IDs.
function hashIdentifier(value) {
  return crypto
    .createHash('sha256')
    .update(String(value))
    .digest('hex');
}


// =====================================================
// FIRESTORE RATE LIMITS
// =====================================================

const RATE_LIMIT_COLLECTION =
  'auth_rate_limits';

const PASSWORD_RESET_LIMIT = 3;
const PASSWORD_RESET_WINDOW =
  60 * 60 * 1000; // 1 hour

const ADMIN_PASSWORD_RESET_LIMIT = 3;
const ADMIN_PASSWORD_RESET_WINDOW =
  60 * 60 * 1000; // 1 hour

const VERIFICATION_EMAIL_LIMIT = 3;
const VERIFICATION_EMAIL_WINDOW =
  60 * 60 * 1000; // 1 hour

const PHONE_OTP_LIMIT = 3;
const PHONE_OTP_WINDOW =
  15 * 60 * 1000; // 15 minutes

const PHONE_OTP_COOLDOWN =
  10 * 60 * 1000; // 10 minutes

const OTP_VERIFY_LIMIT = 10;
const OTP_VERIFY_WINDOW =
  15 * 60 * 1000; // 15 minutes


async function checkAndRecordLimit({
  type,
  identifier,
  maxAttempts,
  windowMs
}) {
  const hashedIdentifier =
    hashIdentifier(identifier);

  const docRef = db
    .collection(RATE_LIMIT_COLLECTION)
    .doc(`${type}_${hashedIdentifier}`);

  const now = Date.now();

  return db.runTransaction(async transaction => {

    const snapshot =
      await transaction.get(docRef);

    let data = snapshot.exists
      ? snapshot.data()
      : null;

    // Start a new window if there is no record
    // or the previous window has expired.
    if (
      !data ||
      !data.expiresAt ||
      data.expiresAt <= now
    ) {
      data = {
        attempts: 1,
        expiresAt: now + windowMs
      };

      transaction.set(
        docRef,
        data,
        { merge: true }
      );

      return {
        allowed: true,
        remaining: maxAttempts - 1
      };
    }

    // Existing active window
    if (data.attempts >= maxAttempts) {
      return {
        allowed: false,
        remaining: 0,
        retryAfter:
          Math.ceil(
            (data.expiresAt - now) / 1000
          )
      };
    }

    data.attempts += 1;

    transaction.set(
      docRef,
      data,
      { merge: true }
    );

    return {
      allowed: true,
      remaining:
        maxAttempts - data.attempts
    };
  });
}


// =====================================================
// EXPRESS IP RATE LIMITERS
// =====================================================

const verificationEmailIpLimiter =
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,

    standardHeaders: true,
    legacyHeaders: false,

    message: {
      success: false,
      message:
        'Too many verification requests. Please try again later.'
    }
  });


const passwordResetIpLimiter =
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,

    standardHeaders: true,
    legacyHeaders: false,

    message: {
      success: false,
      message:
        'Too many password reset requests. Please try again later.'
    }
  });


const adminPasswordResetIpLimiter =
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,

    standardHeaders: true,
    legacyHeaders: false,

    message: {
      success: false,
      message:
        'Too many password reset requests. Please try again later.'
    }
  });


const sendPhoneOtpIpLimiter =
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 3,

    standardHeaders: true,
    legacyHeaders: false,

    message: {
      success: false,
      message:
        'Too many verification code requests. Please try again later.'
    }
  });


const verifyPhoneOtpIpLimiter =
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,

    standardHeaders: true,
    legacyHeaders: false,

    message: {
      success: false,
      message:
        'Too many verification attempts. Please try again later.'
    }
  });


// =====================================================
// SEND VERIFICATION EMAIL
// =====================================================

router.post(
  '/send-verification-email',
  verificationEmailIpLimiter,
  async (req, res) => {

    try {

      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email is required'
        });
      }

      const cleanEmailAddress =
        cleanEmail(email);

      // Email-specific limit
      const limit =
        await checkAndRecordLimit({
          type: 'verification_email',
          identifier: cleanEmailAddress,
          maxAttempts:
            VERIFICATION_EMAIL_LIMIT,
          windowMs:
            VERIFICATION_EMAIL_WINDOW
        });

      if (!limit.allowed) {
        return res.status(429).json({
          success: false,
          message:
            'Too many verification email requests. Please try again later.'
        });
      }

      // Generate Firebase verification link
      const actionCodeSettings = {
        url:
          'https://tunnelmouth.com/verify?verified=true',

        handleCodeInApp: false
      };

      const verificationLink =
        await admin
          .auth()
          .generateEmailVerificationLink(
            cleanEmailAddress,
            actionCodeSettings
          );

      // Send email
      await resend.emails.send({
        from:
          'TunnelMouth <noreply@tunnelmouth.com>',

        to: cleanEmailAddress,

        subject:
          'Verify your TunnelMouth account',

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

      console.error(
        'Verification email error:',
        err
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to send verification email.'
      });
    }
  }
);


// =====================================================
// SEND CUSTOMER PASSWORD RESET EMAIL
// =====================================================

router.post(
  '/send-password-reset-email',
  passwordResetIpLimiter,
  async (req, res) => {

    try {

      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email is required'
        });
      }

      const cleanEmailAddress =
        cleanEmail(email);

      // Email-specific rate limit
      const limit =
        await checkAndRecordLimit({
          type: 'password_reset',
          identifier: cleanEmailAddress,
          maxAttempts:
            PASSWORD_RESET_LIMIT,
          windowMs:
            PASSWORD_RESET_WINDOW
        });

      /*
       * Always return the same generic response
       * when the email-specific limit is reached.
       *
       * This prevents account-enumeration behaviour.
       */
      if (!limit.allowed) {
        return res.json({
          success: true,
          message:
            'If an account exists with this email, a password reset link has been sent.'
        });
      }

      try {

        const resetLink =
          await admin
            .auth()
            .generatePasswordResetLink(
              cleanEmailAddress
            );

        await resend.emails.send({
          from:
            'TunnelMouth <noreply@tunnelmouth.com>',

          to: cleanEmailAddress,

          subject:
            'Reset your TunnelMouth password',

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

      } catch (error) {

        // Log the actual error on the server,
        // but NEVER send it to the customer.
        console.error(
          'Customer password reset error:',
          error
        );
      }

      // Deliberately generic response.
      return res.json({
        success: true,
        message:
          'If an account exists with this email, a password reset link has been sent.'
      });

    } catch (err) {

      console.error(
        'Password reset route error:',
        err
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to process password reset request.'
      });
    }
  }
);


// =====================================================
// ADMIN PASSWORD RESET
// =====================================================

router.post(
  '/send-admin-password-reset-email',
  adminPasswordResetIpLimiter,
  async (req, res) => {

    try {

      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Email is required'
        });
      }

      const cleanEmailAddress =
        cleanEmail(email);

      // Email-specific rate limit
      const limit =
        await checkAndRecordLimit({
          type: 'admin_password_reset',
          identifier: cleanEmailAddress,
          maxAttempts:
            ADMIN_PASSWORD_RESET_LIMIT,
          windowMs:
            ADMIN_PASSWORD_RESET_WINDOW
        });

      if (!limit.allowed) {
        return res.status(429).json({
          success: false,
          message:
            'Too many password reset requests. Please try again later.'
        });
      }

      // Find Firebase Auth user
      let userRecord;

      try {

        userRecord =
          await admin
            .auth()
            .getUserByEmail(
              cleanEmailAddress
            );

      } catch (error) {

        if (
          error.code ===
          'auth/user-not-found'
        ) {
          return res.status(404).json({
            success: false,
            message:
              'No account found with this email'
          });
        }

        throw error;
      }

      // Check admin collection using Firebase UID
      const adminDoc =
        await db
          .collection('admin')
          .doc(userRecord.uid)
          .get();

      if (!adminDoc.exists) {
        return res.status(403).json({
          success: false,
          message:
            'This account is not authorized for the TunnelMouth Admin Portal'
        });
      }

      const adminData =
        adminDoc.data();

      // Allowed roles
      const allowedRoles = [
        'CEO',
        'operations',
        'finance'
      ];

      if (
        !allowedRoles.includes(
          adminData.role
        )
      ) {
        return res.status(403).json({
          success: false,
          message:
            'This account is not authorized for the TunnelMouth Admin Portal'
        });
      }

      // Generate reset link
      const resetLink =
        await admin
          .auth()
          .generatePasswordResetLink(
            cleanEmailAddress
          );

      // Send customized email
      await resend.emails.send({
        from:
          'TunnelMouth <noreply@tunnelmouth.com>',

        to: cleanEmailAddress,

        subject:
          'Reset your TunnelMouth password',

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

      console.error(
        'Admin password reset email error:',
        err
      );

      return res.status(500).json({
        success: false,
        message:
          'Unable to send password reset email'
      });
    }
  }
);


// =====================================================
// SEND PHONE OTP - ROBASE
// =====================================================

router.post(
  '/send-phone-otp',
  sendPhoneOtpIpLimiter,
  async (req, res) => {

    try {

      const { phoneNumber } =
        req.body;

      if (!phoneNumber) {
        return res.status(400).json({
          success: false,
          message:
            'Phone number is required'
        });
      }

      const phone =
        cleanPhoneNumber(
          phoneNumber
        );

      // Phone-specific rate limit
      const limit =
        await checkAndRecordLimit({
          type: 'phone_otp',
          identifier: phone,
          maxAttempts:
            PHONE_OTP_LIMIT,
          windowMs:
            PHONE_OTP_WINDOW
        });

      if (!limit.allowed) {
        return res.status(429).json({
          success: false,
          message:
            'Too many verification code requests. Please try again later.'
        });
      }

      /*
       * 10-minute phone cooldown.
       *
       * This is separate from the IP limiter.
       */
      const cooldown =
        await checkAndRecordLimit({
          type: 'phone_otp_cooldown',
          identifier: phone,
          maxAttempts: 1,
          windowMs:
            PHONE_OTP_COOLDOWN
        });

      if (!cooldown.allowed) {
        return res.status(429).json({
          success: false,
          message:
            'A verification code was recently sent. Please wait before requesting another.'
        });
      }

      const response =
        await fetch(
          'https://api.robase.dev/v1/otp/send',
          {
            method: 'POST',

            headers: {
              'Authorization':
                `Bearer ${process.env.ROBASE_API_KEY}`,

              'Content-Type':
                'application/json'
            },

            body: JSON.stringify({
              phone_number: phone,
              code_length: 6,
              ttl_seconds: 600
            })
          }
        );

      const data =
        await response.json();

      // Log server-side only.
      console.log(
        'Robase send OTP status:',
        response.status
      );

      if (
        !response.ok ||
        !data.id
      ) {

        console.error(
          'Robase send OTP failed:',
          data
        );

        return res.status(400).json({
          success: false,
          message:
            'Unable to send verification code.'
        });
      }

      return res.json({
        success: true,

        // Keep existing app field name.
        pinId: data.id
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
  }
);


// =====================================================
// VERIFY PHONE OTP - ROBASE
// =====================================================

router.post(
  '/verify-phone-otp',
  verifyPhoneOtpIpLimiter,
  async (req, res) => {

    try {

      const { pinId, code } =
        req.body;

      if (!pinId || !code) {
        return res.status(400).json({
          success: false,
          message:
            'Verification code is required'
        });
      }

      // Limit attempts for this specific OTP ID
      const limit =
        await checkAndRecordLimit({
          type: 'otp_verify',
          identifier: pinId,
          maxAttempts:
            OTP_VERIFY_LIMIT,
          windowMs:
            OTP_VERIFY_WINDOW
        });

      if (!limit.allowed) {
        return res.status(429).json({
          success: false,
          message:
            'Too many verification attempts. Please request a new code.'
        });
      }

      const response =
        await fetch(
          'https://api.robase.dev/v1/otp/verify',
          {
            method: 'POST',

            headers: {
              'Authorization':
                `Bearer ${process.env.ROBASE_API_KEY}`,

              'Content-Type':
                'application/json'
            },

            body: JSON.stringify({
              otp_id: pinId,
              code: code
            })
          }
        );

      const data =
        await response.json();

      // Log only the status, not the OTP response.
      console.log(
        'Robase verify OTP status:',
        response.status
      );

      const verified =
        data.valid === true &&
        data.status === 'verified';

      if (
        !response.ok ||
        !verified
      ) {

        return res.status(400).json({
          success: false,
          message:
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
  }
);


// =====================================================
// EXPORT
// =====================================================

module.exports = router;