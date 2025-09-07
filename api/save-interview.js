
import { put } from '@vercel/blob';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body||'{}') : (req.body || {});

    const b64 = body.wav || body.audio;
    const mime = body.mime || 'audio/wav';
    const email = (body.email || '').toString();
    const reply_text = (body.reply_text || '').toString();
    const provider = (body.provider || '').toString();
    const duration_ms = Number(body.duration_ms || 0);

    if (!b64) return res.status(400).json({ error: 'Missing wav/audio base64' });

    const buf = Buffer.from(b64, 'base64');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const ext = mime.includes('webm') ? 'webm' : 'wav';
    const audioName = `interviews/${ts}-${Math.random().toString(36).slice(2,8)}.${ext}`;

    const putOpts = { access: 'public', contentType: mime };
    const audioPut = await put(audioName, buf, putOpts);

    // Save small JSON manifest alongside
    const manifest = {
      createdAt: new Date().toISOString(),
      provider, duration_ms, reply_text, audio_url: audioPut.url, mime
    };
    const metaName = audioName.replace(/\.(wav|webm)$/, '.json');
    await put(metaName, Buffer.from(JSON.stringify(manifest,null,2)), { access: 'public', contentType: 'application/json' });

    // Optional email via SendGrid
    let emailed = false;
    if (email && process.env.SENDGRID_API_KEY) {
      const sgMail = await import('@sendgrid/mail');
      sgMail.default.setApiKey(process.env.SENDGRID_API_KEY);
      const html = `<p>Your interview turn was saved.</p>
        <p><a href="${audioPut.url}">Download audio</a></p>
        <p><pre style="white-space:pre-wrap">${escapeHtml(reply_text || '')}</pre></p>`;
      await sgMail.default.send({
        to: email,
        from: process.env.MAIL_FROM || 'no-reply@vercel.app',
        subject: 'Dad\'s Interview Bot — new turn saved',
        html
      });
      emailed = true;
    }

    return res.status(200).json({ ok: true, audio_url: audioPut.url, emailed });
  } catch (err) {
    console.error('save-interview error', err);
    return res.status(500).json({ error: 'save-interview failed', detail: String(err && err.message || err) });
  }
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
