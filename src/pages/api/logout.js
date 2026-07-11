export const POST = async () => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Set-Cookie': 'token=; Path=/; HttpOnly; Max-Age=0' }
  });
};
