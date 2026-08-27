import speedTest from 'speedtest-net';

async function testSpeed() {
  try {
    const options = { acceptLicense: true, acceptGdpr: true };
    console.log('Running speed test...');
    const result = await speedTest(options);
    console.log('Result:', result.download.bandwidth, result.upload.bandwidth);
  } catch (err) {
    console.error('Error:', err.message);
  }
}

testSpeed();
