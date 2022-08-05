// workerScope() added as workaround since we might need to load this script by <script src>
// https://stackoverflow.com/questions/21408510/chrome-cant-load-web-worker
function workerScope() {

  function clamp(x, min, max) {
    return Math.min(max, Math.max(x, min));
  }

  function mod(x, n) {
    return ((x % n) + n) % n;
  }

  function copyPixelNearest(read, write) {
    const {width, height, data} = read;
    const readIndex = (x, y) => 4 * (y * width + x);

    return (xFrom, yFrom, to) => {

      const nearest = readIndex(
        clamp(Math.round(xFrom), 0, width - 1),
        clamp(Math.round(yFrom), 0, height - 1)
      );

      for (let channel = 0; channel < 3; channel++) {
        write.data[to + channel] = data[nearest + channel];
      }
    };
  }

  function copyPixelBilinear(read, write) {
    const {width, height, data} = read;
    const readIndex = (x, y) => 4 * (y * width + x);

    return (xFrom, yFrom, to) => {
      const xl = clamp(Math.floor(xFrom), 0, width - 1);
      const xr = clamp(Math.ceil(xFrom), 0, width - 1);
      const xf = xFrom - xl;

      const yl = clamp(Math.floor(yFrom), 0, height - 1);
      const yr = clamp(Math.ceil(yFrom), 0, height - 1);
      const yf = yFrom - yl;

      const p00 = readIndex(xl, yl);
      const p10 = readIndex(xr ,yl);
      const p01 = readIndex(xl, yr);
      const p11 = readIndex(xr, yr);

      for (let channel = 0; channel < 3; channel++) {
        const p0 = data[p00 + channel] * (1 - xf) + data[p10 + channel] * xf;
        const p1 = data[p01 + channel] * (1 - xf) + data[p11 + channel] * xf;
        write.data[to + channel] = Math.ceil(p0 * (1 - yf) + p1 * yf);
      }
    };
  }

  // performs a discrete convolution with a provided kernel
  function kernelResample(read, write, filterSize, kernel) {
    const {width, height, data} = read;
    const readIndex = (x, y) => 4 * (y * width + x);

    const twoFilterSize = 2*filterSize;
    const xMax = width - 1;
    const yMax = height - 1;
    const xKernel = new Array(4);
    const yKernel = new Array(4);

    return (xFrom, yFrom, to) => {
      const xl = Math.floor(xFrom);
      const yl = Math.floor(yFrom);
      const xStart = xl - filterSize + 1;
      const yStart = yl - filterSize + 1;

      for (let i = 0; i < twoFilterSize; i++) {
        xKernel[i] = kernel(xFrom - (xStart + i));
        yKernel[i] = kernel(yFrom - (yStart + i));
      }

      for (let channel = 0; channel < 3; channel++) {
        let q = 0;

        for (let i = 0; i < twoFilterSize; i++) {
          const y = yStart + i;
          const yClamped = clamp(y, 0, yMax);
          let p = 0;
          for (let j = 0; j < twoFilterSize; j++) {
            const x = xStart + j;
            const index = readIndex(clamp(x, 0, xMax), yClamped);
            p += data[index + channel] * xKernel[j];

          }
          q += p * yKernel[i];
        }

        write.data[to + channel] = Math.round(q);
      }
    };
  }

  function copyPixelBicubic(read, write) {
    const b = -0.5;
    const kernel = x => {
      x = Math.abs(x);
      const x2 = x*x;
      const x3 = x*x*x;
      return x <= 1 ?
        (b + 2)*x3 - (b + 3)*x2 + 1 :
        b*x3 - 5*b*x2 + 8*b*x - 4*b;
    };

    return kernelResample(read, write, 2, kernel);
  }

  function copyPixelLanczos(read, write) {
    const filterSize = 5;
    const kernel = x => {
      if (x === 0) {
        return 1;
      }
      else {
        const xp = Math.PI * x;
        return filterSize * Math.sin(xp) * Math.sin(xp / filterSize) / (xp * xp);
      }
    };

    return kernelResample(read, write, filterSize, kernel);
  }

  const orientations = {
    PositiveZ0: (out, x, y) => {
      out.x = -1;
      out.y = -x;
      out.z = -y;
    },
    NegativeZ1: (out, x, y) => {
      out.x = 1;
      out.y = x;
      out.z = -y;
    },
    PositiveX2: (out, x, y) => {
      out.x = x;
      out.y = -1;
      out.z = -y;
    },
    NegativeX3: (out, x, y) => {
      out.x = -x;
      out.y = 1;
      out.z = -y;
    },
    PositiveY4: (out, x, y) => {
      out.x = -y;
      out.y = -x;
      out.z = 1;
    },
    NegativeY5: (out, x, y) => {
      out.x = y;
      out.y = -x;
      out.z = -1;
    }
  };

  /** @param {Float64Array} array1 @param {Float64Array} array2 */
  const vectorDot = (array1, array2) => {
    if (array1.length != array2.length) {
      throw new Error('array1.length != array2.length');
    }
    return array1.reduce((s, v, i) => s + v * array2[i], 0);
  }

  class Matrix {
    /** @type {Float64Array} */
    data;
    /** @type {number} */
    nrows;
    /** @type {number} */
    ncolumns;
    /** @param {number} ncolumns @param {number} nrows @param {Array=} data */
    constructor(ncolumns, nrows, data) {
      if (data === undefined) {
        data = new Float64Array(ncolumns * nrows);
      }
      else {
        data = new Float64Array(data);
      }
      if (data.length != ncolumns * nrows) {
        throw new Error('data.length != ncolumns * nrows');
      }
      this.data = data;
      this.nrows = nrows;
      this.ncolumns = ncolumns;
    }

    /** @param {number} irow @param {number} icolumn */
    get(irow, icolumn) {
      return this.data[irow * this.ncolumns + icolumn];
    }

    /** @param {number} irow @param {number} icolumn @param {number} value */
    set(irow, icolumn, value) {
      this.data[irow * this.ncolumns + icolumn] = value;
    }

    /** @param {number} irow */
    getRow(irow) {
      return this.data.slice(irow * this.ncolumns, (irow + 1) * this.ncolumns);
    }

    /** @param {number} icolumn */
    getColumn(icolumn) {
      return this.data.filter((_, i) => (i % this.ncolumns) == icolumn);
    }

    /** @param {Matrix} rhs */
    multiply(rhs) {
      if (this.ncolumns != rhs.nrows) {
        throw new Error('this.ncolumns != rhs.nrows')
      }
      const result = new Matrix(rhs.ncolumns, this.nrows);
      for (let i = 0; i < result.nrows; ++i) {
        for (let j = 0; j < result.ncolumns; ++j) {
          result.set(i, j, vectorDot(this.getRow(i), rhs.getColumn(j)));
        }
      }
      return result;
    }

    /** @param {number[]} args */
    static vector(...args) {
      return new Matrix(1, args.length, args);
    }

    /** @param {number} width */
    static identity(width) {
      const result = new Matrix(width, width, args);
      for (let i = 0; i < width; ++i) {
        result.set(i, i, 1);
      }
      return result;
    }
  }

  function renderFace({data: readData, face, rotation: {yaw, pitch, roll}, interpolation, maxWidth = Infinity}) {

    const faceWidth = Math.min(maxWidth, readData.width / 4);
    const faceHeight = faceWidth;

    const cube = {};
    const orientation = orientations[face];

    const { sin, cos } = Math;
    const rotationYaw = new Matrix(3, 3, [ 
      cos(yaw), -sin(yaw), 0,
      sin(yaw),  cos(yaw), 0,
            0,         0, 1
    ]);
    const rotationPitch = new Matrix(3, 3, [
      cos(pitch), 0, sin(pitch),
                0, 1, 0,
      -sin(pitch), 0, cos(pitch)
    ]);
    const rotationRoll = new Matrix(3, 3, [
      1,         0,          0,
      0, cos(roll), -sin(roll),
      0, sin(roll),  cos(roll)
    ]);
    const rotationMatrix = rotationYaw.multiply(rotationPitch).multiply(rotationRoll);

    const writeData = new ImageData(faceWidth, faceHeight);

    const copyPixel =
      interpolation === 'linear' ? copyPixelBilinear(readData, writeData) :
      interpolation === 'cubic' ? copyPixelBicubic(readData, writeData) :
      interpolation === 'lanczos' ? copyPixelLanczos(readData, writeData) :
      copyPixelNearest(readData, writeData);

    for (let x = 0; x < faceWidth; x++) {
      for (let y = 0; y < faceHeight; y++) {
        const to = 4 * (y * faceWidth + x);

        // fill alpha channel
        writeData.data[to + 3] = 255;

        // get position on cube face
        // cube is centered at the origin with a side length of 2
        orientation(cube, (2 * (x + 0.5) / faceWidth - 1), (2 * (y + 0.5) / faceHeight - 1));
        const v = Matrix.vector(cube.x, cube.y, cube.z);
        const result = rotationMatrix.multiply(v).data;
        const [rx, ry, rz] = result;

        // project cube face onto unit sphere by converting cartesian to spherical coordinates
        const r = Math.sqrt(vectorDot(result, result));
        const lon = mod(Math.atan2(ry, rx), 2 * Math.PI);
        const lat = Math.acos(rz / r);

        copyPixel(readData.width * lon / Math.PI / 2 - 0.5, readData.height * lat / Math.PI - 0.5, to);
      }
    }

    postMessage(writeData);
  }

  onmessage = function({data}) {
    renderFace(data);
  };

}

if (window != self) {
  workerScope();
}

