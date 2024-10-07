import { createServer } from 'http';

const ITEMS = [
  {
    id: 1,
    version: 1,
    label: 'lorem1',
    updatedAt: new Date('2000-01-01T00:00:00.000Z'),
  },
  {
    id: 2,
    version: 1,
    label: 'lorem2',
    updatedAt: new Date('2000-01-02T00:00:00.000Z'),
  },
  {
    id: 3,
    version: -1,
    label: 'this is a tombstone',
    updatedAt: new Date('2000-01-03T00:00:00.000Z'),
  },
];

const PRODUCTS = [
  {
    code: '123',
    version: 1,
    label: 'lorem1',
    lastUpdateDate: new Date('2000-02-01T00:00:00.000Z'),
  },
  {
    code: '456',
    version: 1,
    label: 'lorem2',
    lastUpdateDate: new Date('2000-02-02T00:00:00.000Z'),
  },
];

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  console.log(`${req.method} ${req.url}`);

  const url = new URL(`http://localhost${req.url}`);

  if (req.method === 'GET' && url.pathname === '/key-val-store/foo') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write(
      JSON.stringify({
        version: 1,
        label: 'bar',
      }),
    );
    return res.end();
  } else if (req.method === 'PUT' && url.pathname === '/key-val-store/foo') {
    return res.writeHead(204).end();
  }

  switch (req.method) {
    case 'OPTIONS':
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.writeHead(204).end();
      break;
    case 'GET':
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write(
        JSON.stringify({
          data: req.url.startsWith('/company-products') ? PRODUCTS : ITEMS,
          hasMore: false,
        }),
      );
      res.end();
      break;
    case 'POST':
      res.writeHead(201).end();
      break;
    case 'PUT':
    case 'DELETE':
      if (req.url === '/object-store/6') {
        res.writeHead(404).end();
      } else if (req.url === '/object-store/7') {
        res.writeHead(409);
        res.write(
          JSON.stringify({
            id: 6,
            version: 3,
            label: 'lorem6 remote',
            updatedAt: new Date('2000-01-06T00:00:00.000Z'),
          }),
        );
        res.end();
      } else {
        res.writeHead(204).end();
      }
      break;
    default:
      res.writeHead(404).end();
  }
});

server.listen(4000);
