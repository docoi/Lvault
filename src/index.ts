// Cloudflare Email Worker - Complete Implementation
// Handles EmailMessage events from Cloudflare Email Routing and forwards via MailChannels

export interface Env {
  FORWARD_TO_EMAIL: string;
}

export interface EmailAddress {
  email: string;
  name?: string;
}

export interface EmailMessage {
  readonly from: EmailAddress;
  readonly to: EmailAddress[];
  readonly cc?: EmailAddress[];
  readonly bcc?: EmailAddress[];
  readonly subject: string;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
  setReject(reason: string): void;
}

export interface MailChannelsPayload {
  personalizations: Array<{
    to: Array<{ email: string; name?: string }>;
  }>;
  from: { email: string; name?: string };
  subject: string;
  content: Array<{
    type: string;
    value: string;
  }>;
}

interface ParsedEmailContent {
  textBody: string;
  htmlBody?: string;
  contentType: string;
}

async function parseEmailBody(rawStream: ReadableStream<Uint8Array>): Promise<ParsedEmailContent> {
  console.log('[PARSE] 🔍 Starting comprehensive email body parsing...');
  const reader = rawStream.getReader();
  const chunks: Uint8Array[] = [];
  
  try {
    console.log('[PARSE] 📖 Reading email stream chunks...');
    let chunkCount = 0;
    let totalBytes = 0;
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        console.log(`[PARSE] ✅ Finished reading ${chunkCount} chunks, total: ${totalBytes} bytes`);
        break;
      }
      chunks.push(value);
      chunkCount++;
      totalBytes += value.length;
      console.log(`[PARSE] 📦 Chunk ${chunkCount}: ${value.length} bytes (running total: ${totalBytes})`);
    }
  } finally {
    reader.releaseLock();
    console.log('[PARSE] 🔓 Released stream reader lock');
  }

  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  console.log(`[PARSE] 📏 Combined email size: ${totalLength} bytes`);
  
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  
  console.log('[PARSE] 🔗 Combining chunks into single array...');
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  console.log('[PARSE] 🔤 Decoding bytes to UTF-8 text...');
  const rawText = new TextDecoder().decode(combined);
  console.log(`[PARSE] 📄 Decoded text: ${rawText.length} characters`);
  console.log(`[PARSE] 👀 Preview (first 300 chars): ${rawText.substring(0, 300).replace(/\r?\n/g, '\\n')}...`);
  
  console.log('[PARSE] ✂️ Separating headers from body...');
  const parts = rawText.split(/\r?\n\r?\n/);
  console.log(`[PARSE] 🗂️ Email split into ${parts.length} parts (headers + body sections)`);
  
  if (parts.length < 2) {
    console.log('[PARSE] ⚠️ No clear header/body separation found, treating entire content as body');
    return {
      textBody: rawText.trim(),
      contentType: 'text/plain'
    };
  }

  const headers = parts[0];
  const bodyContent = parts.slice(1).join('\n\n');
  
  console.log(`[PARSE] 📋 Headers section: ${headers.length} characters`);
  console.log(`[PARSE] 📝 Body content: ${bodyContent.length} characters`);
  
  // Parse headers to determine content type
  console.log('[PARSE] 🔍 Analyzing email headers for content type...');
  const contentTypeMatch = headers.match(/Content-Type:\s*([^;\r\n]+)/i);
  const contentType = contentTypeMatch ? contentTypeMatch[1].trim().toLowerCase() : 'text/plain';
  console.log(`[PARSE] 📂 Detected content type: ${contentType}`);
  
  // Check for multipart content
  if (contentType.includes('multipart')) {
    console.log('[PARSE] 📮 Multipart email detected, extracting text and HTML parts...');
    const boundaryMatch = headers.match(/boundary=([^;\r\n]+)/i);
    if (boundaryMatch) {
      const boundary = boundaryMatch[1].replace(/['"]/g, '');
      console.log(`[PARSE] 🔗 Multipart boundary: ${boundary}`);
      
      const parts = bodyContent.split(`--${boundary}`);
      console.log(`[PARSE] 🗂️ Found ${parts.length} multipart sections`);
      
      let textBody = '';
      let htmlBody = '';
      
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i].trim();
        if (!part || part === '--') continue;
        
        console.log(`[PARSE] 📋 Processing multipart section ${i + 1}...`);
        const [partHeaders, ...partBodyParts] = part.split(/\r?\n\r?\n/);
        const partBody = partBodyParts.join('\n\n').trim();
        
        if (partHeaders.includes('text/plain')) {
          textBody = partBody;
          console.log(`[PARSE] 📝 Found text/plain part: ${textBody.length} characters`);
        } else if (partHeaders.includes('text/html')) {
          htmlBody = partBody;
          console.log(`[PARSE] 🌐 Found text/html part: ${htmlBody.length} characters`);
        }
      }
      
      return {
        textBody: textBody || htmlBody || bodyContent.trim(),
        htmlBody: htmlBody || undefined,
        contentType: textBody ? 'text/plain' : (htmlBody ? 'text/html' : contentType)
      };
    }
  }
  
  console.log('[PARSE] ✅ Single-part email, returning body content');
  return {
    textBody: bodyContent.trim(),
    contentType
  };
}

async function forwardEmail(message: EmailMessage, forwardToEmail: string): Promise<void> {
  console.log(`[FORWARD] 🚀 Starting email forwarding process...`);
  console.log(`[FORWARD] 📤 From: ${message.from.email} ${message.from.name ? `(${message.from.name})` : ''}`);
  console.log(`[FORWARD] 📥 Original To: ${message.to.map(addr => `${addr.email} ${addr.name ? `(${addr.name})` : ''}`).join(', ')}`);
  console.log(`[FORWARD] 📍 Forward To: ${forwardToEmail}`);
  console.log(`[FORWARD] 📋 Subject: ${message.subject}`);
  console.log(`[FORWARD] 📏 Raw Size: ${message.rawSize} bytes`);

  console.log(`[FORWARD] 🔍 Parsing email content...`);
  const parsedContent = await parseEmailBody(message.raw);
  console.log(`[FORWARD] ✅ Email content parsed successfully`);
  console.log(`[FORWARD] 📝 Text body: ${parsedContent.textBody.length} characters`);
  console.log(`[FORWARD] 🌐 HTML body: ${parsedContent.htmlBody ? `${parsedContent.htmlBody.length} characters` : 'none'}`);
  console.log(`[FORWARD] 📂 Content type: ${parsedContent.contentType}`);
  
  console.log(`[FORWARD] 🔧 Building MailChannels API payload...`);
  
  // Create content array with both text and HTML if available
  const content = [];
  
  // Always include text version
  const textContent = `
---------- Forwarded Message ----------
From: ${message.from.name ? `${message.from.name} <${message.from.email}>` : message.from.email}
To: ${message.to.map(addr => addr.name ? `${addr.name} <${addr.email}>` : addr.email).join(', ')}
Subject: ${message.subject}
Date: ${new Date().toISOString()}

${parsedContent.textBody}
  `.trim();
  
  content.push({
    type: 'text/plain',
    value: textContent
  });
  
  // Add HTML version if available
  if (parsedContent.htmlBody) {
    const htmlContent = `
<!DOCTYPE html>
<html>
<head><title>Forwarded Message</title></head>
<body>
<div style="border-bottom: 2px solid #ccc; padding-bottom: 10px; margin-bottom: 20px;">
<h3>Forwarded Message</h3>
<p><strong>From:</strong> ${message.from.name ? `${message.from.name} &lt;${message.from.email}&gt;` : message.from.email}</p>
<p><strong>To:</strong> ${message.to.map(addr => addr.name ? `${addr.name} &lt;${addr.email}&gt;` : addr.email).join(', ')}</p>
<p><strong>Subject:</strong> ${message.subject}</p>
<p><strong>Date:</strong> ${new Date().toISOString()}</p>
</div>
<div>${parsedContent.htmlBody}</div>
</body>
</html>
    `.trim();
    
    content.push({
      type: 'text/html',
      value: htmlContent
    });
  }

  const payload: MailChannelsPayload = {
    personalizations: [{
      to: [{ email: forwardToEmail }]
    }],
    from: {
      email: message.from.email,
      name: message.from.name || undefined
    },
    subject: `[Forwarded] ${message.subject}`,
    content
  };
  
  console.log(`[FORWARD] 📦 MailChannels payload summary:`);
  console.log(`[FORWARD]   - From: ${payload.from.email} ${payload.from.name ? `(${payload.from.name})` : ''}`);
  console.log(`[FORWARD]   - To: ${payload.personalizations[0].to[0].email}`);
  console.log(`[FORWARD]   - Subject: ${payload.subject}`);
  console.log(`[FORWARD]   - Content parts: ${payload.content.length}`);
  payload.content.forEach((content, idx) => {
    console.log(`[FORWARD]     Part ${idx + 1}: ${content.type} (${content.value.length} chars)`);
  });
  
  console.log(`[FORWARD] 📋 Full payload (truncated):`, JSON.stringify({
    ...payload,
    content: payload.content.map(c => ({
      type: c.type,
      value: `${c.value.substring(0, 100)}... (${c.value.length} chars total)`
    }))
  }, null, 2));

  console.log(`[FORWARD] 🌐 Sending request to MailChannels API...`);
  const startTime = Date.now();
  
  try {
    const response = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    const responseTime = Date.now() - startTime;
    console.log(`[FORWARD] 📊 MailChannels API response (${responseTime}ms):`);
    console.log(`[FORWARD]   - Status: ${response.status} ${response.statusText}`);
    console.log(`[FORWARD]   - Headers:`, Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[FORWARD] ❌ MailChannels API FAILED:`);
      console.error(`[FORWARD]   - Status: ${response.status}`);
      console.error(`[FORWARD]   - Error Response: ${errorText}`);
      throw new Error(`MailChannels API failed: ${response.status} - ${errorText}`);
    }
    
    const successText = await response.text();
    console.log(`[FORWARD] ✅ MailChannels API SUCCESS:`);
    console.log(`[FORWARD]   - Response: ${successText}`);
    console.log(`[FORWARD] 🎉 Email forwarded successfully in ${responseTime}ms!`);
    
  } catch (fetchError) {
    console.error(`[FORWARD] 💥 Network/API error:`, fetchError);
    throw fetchError;
  }
}

export default {
  async email(message: EmailMessage, env: Env, ctx: ExecutionContext): Promise<Response> {
    const sessionId = `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    
    console.log(`\n🚀 ===============================`);
    console.log(`📧 EMAIL WORKER SESSION: ${sessionId}`);
    console.log(`🕐 STARTED: ${new Date().toISOString()}`);
    console.log(`===============================`);
    
    console.log('📋 📧 INCOMING EMAIL METADATA:');
    console.log(`   📤 From: ${message.from.email} ${message.from.name ? `(${message.from.name})` : '(no name)'}`);
    console.log(`   📥 To: ${message.to.map(addr => `${addr.email} ${addr.name ? `(${addr.name})` : '(no name)'}`).join(', ')}`);
    if (message.cc && message.cc.length > 0) {
      console.log(`   📋 CC: ${message.cc.map(addr => `${addr.email} ${addr.name ? `(${addr.name})` : '(no name)'}`).join(', ')}`);
    }
    if (message.bcc && message.bcc.length > 0) {
      console.log(`   🤫 BCC: ${message.bcc.map(addr => `${addr.email} ${addr.name ? `(${addr.name})` : '(no name)'}`).join(', ')}`);
    }
    console.log(`   📋 Subject: "${message.subject}"`);
    console.log(`   📏 Raw Size: ${message.rawSize} bytes`);
    
    console.log('🔧 ⚙️ ENVIRONMENT CONFIGURATION:');
    if (env.FORWARD_TO_EMAIL) {
      const maskedEmail = `${env.FORWARD_TO_EMAIL.substring(0, Math.min(10, env.FORWARD_TO_EMAIL.length))}...`;
      console.log(`   ✅ FORWARD_TO_EMAIL: ${maskedEmail}`);
    } else {
      console.log(`   ❌ FORWARD_TO_EMAIL: NOT SET`);
    }

    try {
      if (!env.FORWARD_TO_EMAIL) {
        console.error('❌ 🚨 CRITICAL ERROR: FORWARD_TO_EMAIL environment variable not configured');
        console.log(`❌ SESSION ${sessionId} FAILED: Missing configuration`);
        console.log(`===============================\n`);
        return new Response('Configuration error: FORWARD_TO_EMAIL environment variable not set', { 
          status: 500,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
      
      console.log(`✅ 🔍 Configuration validated, proceeding with email forwarding...`);
      await forwardEmail(message, env.FORWARD_TO_EMAIL);
      
      const processingTime = Date.now() - startTime;
      console.log(`🎉 ✅ EMAIL PROCESSING COMPLETED SUCCESSFULLY!`);
      console.log(`⏱️ Total processing time: ${processingTime}ms`);
      console.log(`✅ SESSION ${sessionId} COMPLETED`);
      console.log(`🕐 FINISHED: ${new Date().toISOString()}`);
      console.log(`===============================\n`);
      
      return new Response('Email processed and forwarded successfully', { 
        status: 200,
        headers: { 
          'Content-Type': 'text/plain',
          'X-Session-ID': sessionId,
          'X-Processing-Time': `${processingTime}ms`
        }
      });
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      console.error('💥 🚨 FATAL ERROR during email processing:');
      console.error(`❌ Session: ${sessionId}`);
      console.error(`⏱️ Failed after: ${processingTime}ms`);
      console.error('🔍 Error Details:', error);
      
      if (error instanceof Error) {
        console.error(`   📛 Name: ${error.name}`);
        console.error(`   💬 Message: ${error.message}`);
        console.error(`   📋 Stack: ${error.stack}`);
      } else {
        console.error(`   🤷 Unknown error type:`, typeof error, error);
      }
      
      console.log(`❌ SESSION ${sessionId} FAILED`);
      console.log(`🕐 FAILED AT: ${new Date().toISOString()}`);
      console.log(`===============================\n`);
      
      return new Response(`Email processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`, { 
        status: 500,
        headers: { 
          'Content-Type': 'text/plain',
          'X-Session-ID': sessionId,
          'X-Processing-Time': `${processingTime}ms`,
          'X-Error': 'true'
        }
      });
    }
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    console.log('🌐 HTTP fetch request received (Email Worker)');
    console.log(`📍 URL: ${request.url}`);
    console.log(`🔧 Method: ${request.method}`);
    console.log(`📋 Headers:`, Object.fromEntries(request.headers.entries()));
    
    const workerInfo = {
      message: "Cloudflare Email Worker - Active and Ready",
      purpose: "This worker handles EmailMessage events from Cloudflare Email Routing",
      configuration: {
        forwardToEmailConfigured: !!env.FORWARD_TO_EMAIL
      },
      timestamp: new Date().toISOString()
    };
    
    return new Response(JSON.stringify(workerInfo, null, 2), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'X-Worker-Type': 'email-processor'
      }
    });
  }
} satisfies ExportedHandler<Env>;