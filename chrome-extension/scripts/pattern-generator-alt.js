// pattern-generator.js

class PatternGenerator {
    constructor(options = {}) {
        this.SCALE = options.scale || 2;
        this.width = options.width || 48;
        this.height = options.height || 48;
        this.shapes = [];
        this.base58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    }

    generateImage(seed = 'toto', shapeCount) {
        const drawingCanvas = document.createElement('canvas');
        drawingCanvas.width = this.width * this.SCALE;
        drawingCanvas.height = this.height * this.SCALE;
        const ctx = drawingCanvas.getContext('2d');
        this.shapes = [];

        const randoms = this._generateRandoms(seed, 50); // Generate 50 random values based on the seed

        const centerX = drawingCanvas.width / 2;
        const centerY = drawingCanvas.height / 2;
        const maxSize = Math.min(drawingCanvas.width, drawingCanvas.height) * 0.45;

        for (let i = shapeCount; i > 0; i--) {
            const mod = i * 5; // Increased step to accommodate more randoms
            const size = (i / shapeCount) * maxSize * (0.85 + (randoms[mod] * 0.3));
            const brightness = this._getBrightness(randoms[mod + 1]);
            const lineWidth = this.SCALE * (0.5 + (randoms[mod + 2] * 2));
            const shapeType = this._getShapeType(randoms[mod + 3]);
            const rotation = randoms[mod + 4] * Math.PI * 2; // Rotation between 0 and 2π
            const opacity = 0.5 + (randoms[mod + 5] * 0.5); // Opacity between 0.5 and 1

            this.shapes.push({ size, brightness, lineWidth, shapeType, rotation, opacity });
        }

        this.drawShapes(ctx, centerX, centerY);

        return drawingCanvas;
    }

    _generateRandoms(seed, count) {
        const randoms = [];
        for (let i = 1; i <= count; i++) { // Start from 1 to skip the first character
            const char = seed[i] || seed[i - seed.length] || '1';
            const num = this.base58.indexOf(char);
            randoms.push((num !== -1 ? num : 0) / 58);
        }
        return randoms;
    }

    _getShapeType(randomValue) {
        const shapes = ['circle', 'triangle', 'square', 'pentagon', 'hexagon', 'heptagon', 'octagon'];
        const index = Math.floor(randomValue * shapes.length);
        return shapes[index];
    }

    _getBrightness(randomValue) {
        // Generate a brightness value between 50 and 255 for better contrast
        const brightness = Math.floor(50 + randomValue * 205);
        return brightness;
    }

    drawShapes(ctx, centerX, centerY) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        this.shapes.forEach(shape => {
            ctx.save(); // Save the current state
            ctx.globalAlpha = shape.opacity; // Set opacity

            // Create gradient stroke in grayscale
            const gradient = ctx.createLinearGradient(
                centerX - shape.size / 2,
                centerY - shape.size / 2,
                centerX + shape.size / 2,
                centerY + shape.size / 2
            );
            gradient.addColorStop(0, this._shadeColor(shape.brightness, 30)); // Lighter shade
            gradient.addColorStop(1, this._shadeColor(shape.brightness, 0));  // Original shade

            ctx.strokeStyle = gradient;
            ctx.lineWidth = shape.lineWidth;

            if (shape.shapeType === 'circle') {
                this.drawCircle(ctx, centerX, centerY, shape.size, ctx.strokeStyle, shape.lineWidth);
            } else {
                this.drawPolygon(ctx, centerX, centerY, shape.size, shape.shapeType, shape.rotation, ctx.strokeStyle, shape.lineWidth);
            }

            ctx.restore(); // Restore to original state
        });

        // Draw the outermost shape with a subtle stroke
        if (this.shapes.length > 0) {
            const outerShape = this.shapes[0];
            ctx.beginPath();
            if (outerShape.shapeType === 'circle') {
                ctx.arc(centerX, centerY, outerShape.size * 1.1, 0, Math.PI * 2);
            } else {
                this._beginPolygonPath(ctx, centerX, centerY, outerShape.size * 1.1, this._getShapeSides(outerShape.shapeType), 0);
            }
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)'; // Subtle grey stroke
            ctx.lineWidth = this.SCALE * 0.5;
            ctx.stroke();
        }
    }

    drawPolygon(ctx, centerX, centerY, size, shapeType, rotation, strokeStyle, lineWidth) {
        const sides = this._getShapeSides(shapeType);
        if (sides < 3) return; // Not a valid polygon

        ctx.beginPath();
        this._beginPolygonPath(ctx, centerX, centerY, size, sides, rotation);
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
    }

    _beginPolygonPath(ctx, centerX, centerY, size, sides, rotation) {
        const angleStep = (Math.PI * 2) / sides;
        for (let i = 0; i <= sides; i++) {
            const angle = i * angleStep + rotation - Math.PI / 2; // Start from the top
            const x = centerX + size * Math.cos(angle);
            const y = centerY + size * Math.sin(angle);
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
    }

    _getShapeSides(shapeType) {
        const mapping = {
            'triangle': 3,
            'square': 4,
            'pentagon': 5,
            'hexagon': 6,
            'heptagon': 7,
            'octagon': 8
        };
        return mapping[shapeType] || 0;
    }

    drawCircle(ctx, centerX, centerY, size, strokeStyle, lineWidth) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, size, 0, Math.PI * 2);
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
    }

    _shadeColor(brightness, percent) {
        // Lighten the brightness by a percentage
        const lightened = Math.min(255, brightness + percent);
        return `rgb(${lightened}, ${lightened}, ${lightened})`;
    }
}

// Export the class for use in other modules
const isNode = typeof module !== 'undefined' && module.exports;
if (isNode) { module.exports = PatternGenerator; }
// If using ES6 modules, uncomment the following line
// export default PatternGenerator;
