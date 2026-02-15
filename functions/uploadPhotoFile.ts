import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file');

    if (!file) {
      return Response.json({ error: 'No file provided' }, { status: 400 });
    }

    // Convert file to blob
    const buffer = await file.arrayBuffer();
    const blob = new Blob([buffer], { type: file.type });

    // Upload using base44 integration
    const result = await base44.asServiceRole.integrations.Core.UploadFile({
      file: blob
    });

    if (!result || !result.file_url) {
      throw new Error('Upload failed - no URL returned');
    }

    return Response.json({
      success: true,
      file_url: result.file_url
    });
  } catch (error) {
    console.error('File upload error:', error);
    return Response.json(
      { error: error.message || 'Upload failed' },
      { status: 500 }
    );
  }
});