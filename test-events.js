import handler from './api/events.js';

const mockReq = {
  query: { symbol: 'EURUSD' }
};

const mockRes = {
  status: (code) => {
    return {
      json: (data) => {
        console.log(`Status: ${code}`);
        console.log(JSON.stringify(data, null, 2));
      }
    };
  }
};

handler(mockReq, mockRes);
