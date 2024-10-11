// pattern-generator.js

class PatternGenerator {
    constructor(options = {}) {
        this.SCALE = options.scale || 2;
        this.width = options.width || 48;
        this.height = options.height || 48;
        this.shapes = [];
        this.drawingCanvas = document.createElement('canvas');
        this.drawingCanvas.width = this.width * this.SCALE;
        this.drawingCanvas.height = this.height * this.SCALE;
    }

    generateImage(seed, shapeCount) {
        const ctx = this.drawingCanvas.getContext('2d');
        this.shapes = [];

        const random = (seed) => {
            let num = parseInt(seed, 16) || 0;
            return () => {
                num = (num * 1664525 + 1013904223) % 4294967296;
                return num / 4294967296;
            };
        };

        const rand = random(seed);

        const centerX = this.drawingCanvas.width / 2;
        const centerY = this.drawingCanvas.height / 2;
        const maxSize = Math.min(this.drawingCanvas.width, this.drawingCanvas.height) * 0.45;

        const circleThreshold = 0.4 + rand() * 0.2;

        for (let i = shapeCount; i > 0; i--) {
            const size = (i / shapeCount) * maxSize;
            const brightness = Math.floor(200 + rand() * 55);
            const lineWidth = this.SCALE * (0.2 + rand() * 0.8);
            const isCircle = rand() < circleThreshold;

            this.shapes.push({ size, brightness, lineWidth, isCircle });
        }

        this.drawShapes(ctx, centerX, centerY);

        return this.drawingCanvas;
    }

    drawShapes(ctx, centerX, centerY) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        // Re-add shadows for the shapes
        ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
        ctx.shadowBlur = 4 * this.SCALE;

        this.shapes.forEach(shape => {
            const strokeStyle = `rgb(${shape.brightness}, ${shape.brightness}, ${shape.brightness})`;

            if (shape.isCircle) {
                this.drawCircle(ctx, centerX, centerY, shape.size, strokeStyle, shape.lineWidth);
            } else {
                this.drawHexagon(ctx, centerX, centerY, shape.size, strokeStyle, shape.lineWidth);
            }
        });

        // Draw the outer circle with a subtle stroke
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;

        ctx.beginPath();
        ctx.arc(centerX, centerY, this.shapes[0].size * 1.1, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = this.SCALE * 0.5;
        ctx.stroke();
    }

    drawHexagon(ctx, centerX, centerY, size, strokeStyle, lineWidth) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = i * Math.PI / 3 - Math.PI / 2;
            const x = centerX + size * Math.cos(angle);
            const y = centerY + size * Math.sin(angle);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
    }

    drawCircle(ctx, centerX, centerY, size, strokeStyle, lineWidth) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, size, 0, Math.PI * 2);
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
    }
}

// Export the class for use in other modules
//export default PatternGenerator;

const isNode = typeof module !== 'undefined' && module.exports;
if (isNode) { module.exports = PatternGenerator; }
//module.exports = PatternGenerator;
