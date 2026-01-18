import nodemailer from 'nodemailer';
import { logger } from './utils/logger';

// Email transporter configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  auth: process.env.SMTP_USER && process.env.SMTP_PASS ? { 
    user: process.env.SMTP_USER, 
    pass: process.env.SMTP_PASS 
  } : undefined,
  tls: {
    rejectUnauthorized: false
  }
});

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  try {
    const from = process.env.SMTP_FROM || 'support@aveniaichat.com';
    
    const mailOptions = {
      from,
      to,
      subject: 'Avenia - Email Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #00c896;">Avenia Email Verification</h2>
          <p>Hello,</p>
          <p>Please use the code below to verify your account:</p>
          <div style="background-color: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0;">
            <h1 style="color: #00c896; font-size: 32px; margin: 0; letter-spacing: 5px;">${code}</h1>
          </div>
          <p>This code is valid for 10 minutes.</p>
          <p>If you did not request this, you can safely ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #666; font-size: 12px;">This email was sent by the Avenia app.</p>
        </div>
      `,
      text: `Avenia Email Verification Code: ${code}\n\nThis code is valid for 10 minutes.`
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Verification email sent to ${to}`);
  } catch (error) {
    logger.error('Failed to send verification email:', error);
    throw error;
  }
}



