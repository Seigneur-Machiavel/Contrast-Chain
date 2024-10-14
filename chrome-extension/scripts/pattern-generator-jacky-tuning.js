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

        const randoms = [];
        for (let i = 1; i < 50; i++) { // don't use the first letter of the seed
            const char = seed[i] || seed[i - seed.length] || '1';
            let num = this.base58.indexOf(char) || 0;
            randoms.push(num / 58);
        }
        //console.log('randoms:', randoms);

        const centerX = drawingCanvas.width / 2;
        const centerY = drawingCanvas.height / 2;
        const maxSize = Math.min(drawingCanvas.width, drawingCanvas.height) * 0.45;

        const circleThreshold = 0.3 + (randoms[0] * 0.4);

        for (let i = shapeCount; i > 0; i--) {
            const mod = i * 4;
            const size = (i / shapeCount) * maxSize * (.95 + (randoms[mod + 1] * .1));
            const brightness = Math.floor(100 + (randoms[mod + 2] * 155));
            const lineWidth = this.SCALE * (.2 + (randoms[mod + 3] * 1.4));
            const isCircle = randoms[mod + 4] < circleThreshold;
            //console.log('size:', size, 'brightness:', brightness, 'lineWidth:', lineWidth, 'isCircle:', isCircle);

            this.shapes.push({ size, brightness, lineWidth, isCircle });
        }

        // Determine if the logo should be shiny
        // We'll use a random value to decide; e.g., 1% chance
        // To keep it deterministic, use one of the randoms
        const shinyChance = 0.03; // 3% chance
        const shinyRandom = randoms[49] || Math.random(); // Use the last random or fallback
        this.isShiny = shinyRandom < shinyChance;

        this.drawShapes(ctx, centerX, centerY);

        if (this.isShiny) {
            this.applyShinyEffect(ctx);
        }

        return drawingCanvas;
    }

    drawShapes(ctx, centerX, centerY) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        // Re-add shadows for the shapes
        ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
        ctx.shadowBlur = 4 * this.SCALE;

        this.shapes.forEach(shape => {
            if (this.isShiny) {
                // Apply gradient stroke for iridescent effect
                const gradientStroke = this.createIridescentGradient(ctx, centerX, centerY, shape.size);
                if (shape.isCircle) {
                    this.drawCircle(ctx, centerX, centerY, shape.size, gradientStroke, shape.lineWidth);
                } else {
                    this.drawHexagon(ctx, centerX, centerY, shape.size, gradientStroke, shape.lineWidth);
                }
            } else {
                // Regular stroke without shiny effect
                const strokeStyle = `rgb(${shape.brightness}, ${shape.brightness}, ${shape.brightness})`;
                if (shape.isCircle) {
                    this.drawCircle(ctx, centerX, centerY, shape.size, strokeStyle, shape.lineWidth);
                } else {
                    this.drawHexagon(ctx, centerX, centerY, shape.size, strokeStyle, shape.lineWidth);
                }
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

    createIridescentGradient(ctx, centerX, centerY, size) {
        // Create a radial gradient centered on the shape
        const gradient = ctx.createRadialGradient(centerX, centerY, size * 0.5, centerX, centerY, size);
        gradient.addColorStop(0, 'rgba(255, 0, 255, 0.8)');   // Magenta
        gradient.addColorStop(0.2, 'rgba(0, 255, 255, 0.8)'); // Cyan
        gradient.addColorStop(0.4, 'rgba(0, 255, 0, 0.8)');   // Green
        gradient.addColorStop(0.6, 'rgba(255, 255, 0, 0.8)'); // Yellow
        gradient.addColorStop(0.8, 'rgba(255, 0, 0, 0.8)');   // Red
        gradient.addColorStop(1, 'rgba(255, 0, 255, 0.8)');   // Magenta

        return gradient;
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

    applyShinyEffect(ctx) {
        // This method is no longer needed since the shiny effect is applied directly to the strokes
        // However, if you want additional effects, you can implement them here
        // For now, we'll leave it empty to prevent applying a full canvas overlay
    }
}

// Export the class for use in other modules
//export default PatternGenerator;

const isNode = typeof module !== 'undefined' && module.exports;
if (isNode) { module.exports = PatternGenerator; }
//module.exports = PatternGenerator;
