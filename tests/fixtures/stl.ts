/** Closed, outward-wound 20-unit cube; real binary STL for API and browser tests. */
export function cubeStl() {
  const vertices = [
    [-10, -10, -10],
    [10, -10, -10],
    [10, 10, -10],
    [-10, 10, -10],
    [-10, -10, 10],
    [10, -10, 10],
    [10, 10, 10],
    [-10, 10, 10],
  ];
  const faces = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ];
  const buffer = Buffer.alloc(84 + faces.length * 50);
  buffer.writeUInt32LE(faces.length, 80);
  faces.forEach((face, i) =>
    face.forEach((v, j) =>
      vertices[v].forEach((value, k) =>
        buffer.writeFloatLE(value, 84 + i * 50 + 12 + j * 12 + k * 4),
      ),
    ),
  );
  return buffer;
}
