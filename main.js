const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');

var downloadList = [{},{},{},{},{},{}]

function downloadAll(urls) {
  var link = document.createElement('a');

  link.style.display = 'none';

  document.body.appendChild(link);

  for (var i = urls.length-1; i >= 0; i--) {
    link.setAttribute('download', urls[i].FileName);
    link.setAttribute('href', urls[i].Url);
    link.click();
    sleep(400)
  }

  document.body.removeChild(link);
}

function sleep(milliseconds) {
  const date = Date.now();
  let currentDate = null;
  do {
    currentDate = Date.now();
  } while (currentDate - date < milliseconds);
}

class RadioInput {
  constructor(name, onChange) {
    this.inputs = document.querySelectorAll(`input[name=${name}]`);
    for (let input of this.inputs) {
      input.addEventListener('change', onChange);
    }
  }

  get value() {
    for (let input of this.inputs) {
      if (input.checked) {
        return input.value;
      }
    }
  }
}

class Input {
  constructor(id, onChange) {
    this.input = document.getElementById(id);
    this.input.addEventListener('change', onChange);
    this.valueAttrib = this.input.type === 'checkbox' ? 'checked' : 'value';
  }

  get value() {
    return this.input[this.valueAttrib];
  }
}

class CubeFace {
  constructor(faceName) {
    this.faceName = faceName;

    this.anchor = document.createElement('a');
    this.anchor.style.position='absolute';
    this.anchor.title = faceName;

    this.img = document.createElement('img');
    this.img.style.filter = 'blur(4px)';

    this.anchor.appendChild(this.img);
  }

  setPreview(url, x, y) {
    this.img.src = url;
    this.anchor.style.left = `${x}px`;
    this.anchor.style.top = `${y}px`;
  }

  setDownload(url, fileExtension) {
    this.anchor.href = url;
    this.anchor.download = `${this.faceName[2]}.${fileExtension}`;
    this.img.style.filter = '';
	downloadList[parseInt(this.faceName[2],10)] = { Url:url, FileName: this.faceName[2]+"."+fileExtension}
    console.log(JSON.stringify(downloadList))
  }
}

function removeChildren(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

const mimeType = {
  'jpg': 'image/jpeg',
  'png': 'image/png'
};

function getDataURL(imgData, extension) {
  canvas.width = imgData.width;
  canvas.height = imgData.height;
  ctx.putImageData(imgData, 0, 0);
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(URL.createObjectURL(blob)), mimeType[extension], 0.92);
  });
}

const dom = {
  imageInput: document.getElementById('imageInput'),
  faces: document.getElementById('faces'),
  generating: document.getElementById('generating')
};

dom.imageInput.addEventListener('change', loadImage);

const settings = {
  cubeRotation: new Input('cubeRotation', loadImage),
  interpolation: new RadioInput('interpolation', loadImage),
  format: new RadioInput('format', loadImage),
};

const facePositions = {
  PositiveZ: {x: 1, y: 1},
  NegativeZ: {x: 3, y: 1},
  PositiveX: {x: 2, y: 1},
  NegativeX: {x: 0, y: 1},
  PositiveY: {x: 1, y: 0},
  NegativeY: {x: 1, y: 2}
};

/*
const facePositions = {
  PositiveZ: {x: 1, y: 1},
  NegativeZ: {x: 3, y: 1},
  PositiveX: {x: 2, y: 1},
  NegativeX: {x: 0, y: 1},
  PositiveY: {x: 1, y: 0},
  NegativeY: {x: 1, y: 2}
};
*/

function loadImage() {
  downloadList = [{},{},{},{},{},{}]
  const file = dom.imageInput.files[0];

  if (!file) {
    return;
  }

  const img = new Image();

  img.src = URL.createObjectURL(file);

  img.addEventListener('load', () => {
    const {width, height} = img;
    canvas.width = width;
    canvas.height = height;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, width, height);

    processImage(data);
  });
}

let finished = 0;
let workers = [];

function processImage(data) {
  removeChildren(dom.faces);
  dom.generating.style.visibility = 'visible';

  for (let worker of workers) {
    worker.terminate();
  }

  for (let [faceName, position] of Object.entries(facePositions)) {
    renderFace(data, faceName, position);
  }
}

function renderFace(data, faceName, position) {
  const face = new CubeFace(faceName);
  dom.faces.appendChild(face.anchor);

  const options = {
    data: data,
    face: faceName,
    rotation: Math.PI * settings.cubeRotation.value / 180,
    interpolation: settings.interpolation.value,
  };

  const worker = new Worker('convert.js');

  const setDownload = ({data: imageData}) => {
    const extension = settings.format.value;

    getDataURL(imageData, extension)
      .then(url => face.setDownload(url, extension));

    finished++;

    if (finished === 6) {
      dom.generating.style.visibility = 'hidden';
      finished = 0;
      workers = [];
    }
  };

  const setPreview = ({data: imageData}) => {
    const x = imageData.width * position.x;
    const y = imageData.height * position.y;

    getDataURL(imageData, 'jpg')
      .then(url => face.setPreview(url, x, y));

    worker.onmessage = setDownload;
    worker.postMessage(options);
  };

  worker.onmessage = setPreview;
  worker.postMessage(Object.assign({}, options, {
    maxWidth: 200,
    interpolation: 'linear',
  }));

  workers.push(worker);
}
