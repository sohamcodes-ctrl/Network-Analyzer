const output = `Ping statistics for 127.0.0.1:
    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),
Approximate round trip times in milli-seconds:
    Minimum = 0ms, Maximum = 0ms, Average = 0ms`;
const received = Number(output.match(/Received\s*=\s*(\d+)/i)?.[1] || 0);
const loss = Number(output.match(/\((\d+)%\s*loss\)/i)?.[1] || (100 - received / 4 * 100));
console.log({ received, loss });
