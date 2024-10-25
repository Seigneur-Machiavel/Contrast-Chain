

class ParticleAnimation {
    animationColor1 = '255, 255, 255';
    animationColor2 = '0, 0, 0';
    canvas = null;
    ctx = null;
    simplex = null;
    time = 0;
    particles = [];
    connections = [];
    animationId = null;

    // ==================== Configuration Objects ====================
    systemConfig = {
        motion: {
            flowSpeed: 0.65,
            complexity: 3,
            drift: 0.05
        },
        field: {
            intensity: 0.8,
            patterns: ['spiral', 'wave', 'circular'],
            blendStrength: 0.3
        },
        detail: {
            levels: 3,
            scale: 1.5,
            rotation: Math.PI / 6
        }
    }
    canvasConfig = {
        //backgroundColor: 'transparent',
        backgroundColor: `rgb(${window.animationColor1})`,
        resizeDebounce: 100,
    }
    waveConfig = {
        scale1: 0.03,
        scale2: 0.02,
        scale3: 0.01,
        amplitude: 8,
    }
    particleConfig = {
        number: 64,
        radius: 64,
        sizeCategories: {
            probabilities: {
                huge: 0.08,
                large: 0.15,
                medium: 0.27,
                small: 0.50,
            },
            multipliers: {
                huge: { min: 2, max: 5 },
                large: { min: .5, max: 2 },
                medium: { min: .2, max: .5 },
                small: { min: .1, max: .2 },
            },
        },
        sizeRange: [2, 8],
        pulsing: {
            frequencyRange: [0.5, 4],
            amplitudeRange: [0.8, 2.0],
            waveforms: ['sin', 'triangle'],
        },
        colors: {
            primary: `rgb(${window.animationColor2})`,
        },
    }
    connectionConfig = {
        maxConnections: 8,
        distanceThreshold: 250,
        decayRange: [0.002, 0.008],
        thicknessRange: [0.1, 1],
        colors: {
            primary: `rgb(${window.animationColor2})`,
        },
        tetherPhysics: {
            tension: 0.5,
            dampening: 0.7,
            rigidity: 0.05,
            segments: 8,
            noiseInfluence: 0.5
        },
        shooting: {
            speed: 0.02,
            fadeDuration: 60,
        }
    }
    animationConfig = {
        timeIncrement: 0.01,
        fps: 60,
    }

    // ==================== Initialization ====================
    init(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = this.canvas.getContext('2d');
        this.simplex = new SimplexNoise();

        this.initParticles();
        this.animate();
    }

    // ==================== Utility Functions ====================
    static map(value, start1, stop1, start2, stop2) {
        return start2 + ((stop2 - start2) * ((value - start1) / (stop1 - start1)));
    }
    static getWaveform(type, value) {
        switch (type) {
            case 'triangle':
                return Math.asin(Math.sin(value)) / (Math.PI / 2);
            default:
                return Math.sin(value);
        }
    }

    // ==================== Motion Pattern Functions ====================
    spiralPattern(x, y, z, t) {
        const u = Math.cos(x) * Math.sin(2 * y);
        const v = Math.sin(x) * Math.sin(2 * y);
        const w = Math.cos(2 * y);
        return (u + v + w) * Math.sin(t);
    }
    wavePattern(x, y, z, t) {
        const u = (1 + y / 2 * Math.cos(x / 2)) * Math.cos(x);
        const v = (1 + y / 2 * Math.cos(x / 2)) * Math.sin(x);
        const w = y / 2 * Math.sin(x / 2);
        return (u * v * w) * Math.cos(t);
    }
    circularPattern(s, t, p, q) {
        const r = Math.cos(q * s) + 2;
        const x = r * Math.cos(p * s);
        const y = r * Math.sin(p * s);
        const z = -Math.sin(q * s);
        return { x, y, z };
    }
    complexMotion(x, y, z, t) {
        const wave1 = Math.sin(x * this.waveConfig.scale1 + t) *
            Math.cos(y * this.waveConfig.scale1 + t) * 0.5;
        const wave2 = Math.sin(x * this.waveConfig.scale2 - t * 0.7) *
            Math.cos(z * this.waveConfig.scale2 + t * 1.2) * 0.3;
        const wave3 = Math.sin(y * this.waveConfig.scale3 + t * 1.1) *
            Math.cos(z * this.waveConfig.scale3 - t * 0.9) * 0.2;

        const spiral = this.spiralPattern(x * 0.01, y * 0.01, z * 0.01, t) *
            this.systemConfig.field.intensity;
        const wave = this.wavePattern(x * 0.01, y * 0.01, z * 0.01, t) *
            this.systemConfig.field.intensity;
        const flow = Math.tanh(Math.sin(x * 0.02 + t) * Math.cos(y * 0.02 - t)) *
            this.systemConfig.motion.flowSpeed;
        const noise = this.simplex.noise4D(x * 0.01, y * 0.01, z * 0.01, t) *
            this.systemConfig.field.blendStrength;

        return (wave1 + wave2 + wave3) * this.waveConfig.amplitude +
            spiral * Math.sin(t) +
            wave * Math.cos(t) +
            flow +
            noise;
    }

    // ==================== Particle Class ====================
    Particle = class {
        constructor() {
            this.reset();
            this.phi = Math.random() * Math.PI * 2;
            this.theta = Math.random() * Math.PI;
            this.z = 0;

            this.sizeCategory = this.assignSizeCategory(Math.random());
            this.sizeMultiplier = this.getSizeMultiplier();
            this.baseSize = ParticleAnimation.map(
                Math.random(),
                0,
                1,
                ParticleAnimation.particleConfig.sizeRange[0],
                ParticleAnimation.particleConfig.sizeRange[1]
            ) * this.sizeMultiplier;

            this.noiseOffsetX = Math.random() * 1000;
            this.noiseOffsetY = Math.random() * 1000;

            this.pulseFrequency = ParticleAnimation.map(
                Math.random(),
                0,
                1,
                ParticleAnimation.particleConfig.pulsing.frequencyRange[0],
                ParticleAnimation.particleConfig.pulsing.frequencyRange[1]
            );
            this.pulseAmplitude = ParticleAnimation.map(
                Math.random(),
                0,
                1,
                ParticleAnimation.particleConfig.pulsing.amplitudeRange[0],
                ParticleAnimation.particleConfig.pulsing.amplitudeRange[1]
            );
            this.pulsePhase = Math.random() * Math.PI * 2;
            this.waveformType = ParticleAnimation.particleConfig.pulsing.waveforms[
                Math.floor(Math.random() * ParticleAnimation.particleConfig.pulsing.waveforms.length)
            ];

            this.deformationPhase = Math.random() * Math.PI * 2;
            this.deformationFrequency = Math.random() * 2 + 1;

            this.motionPhase = Math.random() * Math.PI * 2;
            this.motionX = Math.floor(Math.random() * 3) + 2;
            this.motionY = Math.floor(Math.random() * 3) + 3;
        }
        // ... Particle class methods continued

        assignSizeCategory(rand) {
            const { probabilities } = ParticleAnimation.particleConfig.sizeCategories;
            const cumulative = [];
            let sum = 0;
            for (let key in probabilities) {
                sum += probabilities[key];
                cumulative.push({ category: key, threshold: sum });
            }
            for (let item of cumulative) {
                if (rand < item.threshold) return item.category;
            }
            return 'small';
        }

        getSizeMultiplier() {
            const { multipliers } = ParticleAnimation.particleConfig.sizeCategories;
            const category = this.sizeCategory;
            const range = multipliers[category];
            return ParticleAnimation.map(Math.random(), 0, 1, range.min, range.max);
        }

        reset() {
            this.radius = ParticleAnimation.particleConfig.radius;
            this.updatePosition();
        }

        updatePosition() {
            this.phi += 0.001;
            this.z = this.radius * Math.cos(this.theta);
            const projectedRadius = this.radius * Math.sin(this.theta);
            this.x = ParticleAnimation.canvas.width / 2 + projectedRadius * Math.cos(this.phi);
            this.y = ParticleAnimation.canvas.height / 2 + projectedRadius * Math.sin(this.phi);

            const circularMotion = ParticleAnimation.circularPattern(
                this.motionPhase,
                ParticleAnimation.time,
                this.motionX,
                this.motionY
            );
            const motionInfluence = ParticleAnimation.systemConfig.motion.drift;

            this.x += circularMotion.x * motionInfluence * this.radius;
            this.y += circularMotion.y * motionInfluence * this.radius;
            this.z += circularMotion.z * motionInfluence * this.radius;

            this.motionPhase += 0.001;
            this.scale = Math.tanh(ParticleAnimation.map(this.z, -this.radius, this.radius, -1, 1)) * 0.5 + 0.7;
        }

        update() {
            this.updatePosition();
            const motion = ParticleAnimation.complexMotion(this.x, this.y, this.z, ParticleAnimation.time);

            let noise = 0;
            let amplitude = 1;
            let frequency = 1;

            for (let i = 0; i < ParticleAnimation.systemConfig.detail.levels; i++) {
                noise += amplitude * ParticleAnimation.simplex.noise3D(
                    this.x * frequency * 0.01,
                    this.y * frequency * 0.01,
                    ParticleAnimation.time * 0.2
                );
                amplitude *= 0.5;
                frequency *= ParticleAnimation.systemConfig.detail.scale;
            }

            const flowEffect = Math.sin(this.z * ParticleAnimation.systemConfig.motion.flowSpeed + ParticleAnimation.time);
            const blendEffect = Math.cos(noise * ParticleAnimation.systemConfig.field.intensity);

            this.x += (motion * 5 + noise * 4) * this.scale * flowEffect;
            this.y += (motion * 5 + noise * 4) * this.scale * blendEffect;
        }

        draw() {
            const scaledSize = this.baseSize * this.scale;
            const mainPulse = ParticleAnimation.getWaveform(
                this.waveformType,
                ParticleAnimation.time * this.pulseFrequency + this.pulsePhase
            );
            const secondaryPulse = Math.sin(ParticleAnimation.time * this.deformationFrequency + this.deformationPhase);
            const deformation = mainPulse * this.pulseAmplitude + secondaryPulse * 0.3;

            const currentSizeX = scaledSize * (1 + deformation * 0.2);
            const currentSizeY = scaledSize * (1 - deformation * 0.15);

            ParticleAnimation.ctx.save();
            ParticleAnimation.ctx.translate(this.x, this.y);
            ParticleAnimation.ctx.rotate(ParticleAnimation.time * 0.5 + this.pulsePhase);

            ParticleAnimation.ctx.beginPath();
            ParticleAnimation.ctx.ellipse(0, 0, currentSizeX, currentSizeY, 0, 0, Math.PI * 2);
            ParticleAnimation.ctx.fillStyle = ParticleAnimation.particleConfig.colors.primary;
            ParticleAnimation.ctx.fill();

            ParticleAnimation.ctx.restore();
        }
    }

    // ==================== Connection Class ====================
    Connection = class {
        constructor(p1, p2) {
            this.p1 = p1;
            this.p2 = p2;
            this.life = 1;
            this.decay = ParticleAnimation.map(
                Math.random(),
                0,
                1,
                ParticleAnimation.connectionConfig.decayRange[0],
                ParticleAnimation.connectionConfig.decayRange[1]
            );
            this.pulsePhase = Math.random() * Math.PI * 2;
            this.thickness = ParticleAnimation.map(
                Math.random(),
                0,
                1,
                ParticleAnimation.connectionConfig.thicknessRange[0],
                ParticleAnimation.connectionConfig.thicknessRange[1]
            );
            this.waveformType = ParticleAnimation.particleConfig.pulsing.waveforms[
                Math.floor(Math.random() * ParticleAnimation.particleConfig.pulsing.waveforms.length)
            ];

            const { tetherPhysics } = ParticleAnimation.connectionConfig;
            this.segments = tetherPhysics.segments;
            this.points = Array(this.segments).fill().map(() => ({
                x: 0, y: 0,
                vx: 0, vy: 0,
                ax: 0, ay: 0
            }));

            this.tension = tetherPhysics.tension;
            this.dampening = tetherPhysics.dampening;
            this.rigidity = tetherPhysics.rigidity;
            this.noiseInfluence = tetherPhysics.noiseInfluence;

            this.flowOffset = Math.random() * 1000;
            this.turbulenceScale = Math.random() * 0.3 + 0.7;
            this.timeScale = Math.random() * 0.5 + 0.75;

            this.updateControlPoints();

            this.progress = 0;
            this.speed = ParticleAnimation.connectionConfig.shooting.speed;
            this.fading = false;
            this.fadeCounter = 0;
        }

        updateControlPoints() {
            const dx = (this.p2.x - this.p1.x) / (this.segments - 1);
            const dy = (this.p2.y - this.p1.y) / (this.segments - 1);

            this.points.forEach((point, i) => {
                point.x = this.p1.x + dx * i;
                point.y = this.p1.y + dy * i;
                point.vx = (Math.random() - 0.5) * 0.5;
                point.vy = (Math.random() - 0.5) * 0.5;
            });
        }

        updatePhysics() {
            const dt = 1 / 60;

            for (let i = 1; i < this.segments - 1; i++) {
                const point = this.points[i];
                const prevPoint = this.points[i - 1];
                const nextPoint = this.points[i + 1];

                point.ax = 0;
                point.ay = 0;

                const dx1 = prevPoint.x - point.x;
                const dy1 = prevPoint.y - point.y;
                const dx2 = nextPoint.x - point.x;
                const dy2 = nextPoint.y - point.y;

                const dist1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
                const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

                if (dist1 === 0 || dist2 === 0) continue;

                const springForce1 = this.tension * (dist1 - 30);
                const springForce2 = this.tension * (dist2 - 30);

                point.ax += (dx1 / dist1) * springForce1 + (dx2 / dist2) * springForce2;
                point.ay += (dy1 / dist1) * springForce1 + (dy2 / dist2) * springForce2;

                const turbulence = ParticleAnimation.simplex.noise3D(
                    point.x * 0.01 + this.flowOffset,
                    point.y * 0.01,
                    ParticleAnimation.time * this.timeScale
                ) * this.turbulenceScale;

                const noiseX = ParticleAnimation.simplex.noise3D(
                    point.x * 0.02 + ParticleAnimation.time,
                    point.y * 0.02,
                    this.flowOffset
                ) * this.noiseInfluence;

                const noiseY = ParticleAnimation.simplex.noise3D(
                    point.x * 0.02,
                    point.y * 0.02 + ParticleAnimation.time,
                    this.flowOffset + 100
                ) * this.noiseInfluence;

                point.ax += noiseX * turbulence;
                point.ay += noiseY * turbulence;

                point.vx += point.ax * dt;
                point.vy += point.ay * dt;

                point.vx *= this.dampening;
                point.vy *= this.dampening;

                point.x += point.vx;
                point.y += point.vy;

                const idealX = this.p1.x + (this.p2.x - this.p1.x) * (i / (this.segments - 1));
                const idealY = this.p1.y + (this.p2.y - this.p1.y) * (i / (this.segments - 1));

                point.x += (idealX - point.x) * this.rigidity;
                point.y += (idealY - point.y) * this.rigidity;
            }

            this.points[0].x = this.p1.x;
            this.points[0].y = this.p1.y;
            this.points[this.segments - 1].x = this.p2.x;
            this.points[this.segments - 1].y = this.p2.y;
        }

        update() {
            if (!this.fading) {
                this.progress += this.speed;
                if (this.progress >= 1) {
                    this.progress = 1;
                    this.fading = true;
                }
            } else {
                this.fadeCounter++;
                if (this.fadeCounter >= ParticleAnimation.connectionConfig.shooting.fadeDuration) {
                    this.life -= this.decay;
                }
            }

            this.updatePhysics();
            return this.life > 0;
        }

        draw() {
            const dx = this.p2.x - this.p1.x;
            const dy = this.p2.y - this.p1.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > ParticleAnimation.connectionConfig.distanceThreshold) return;

            const pulse = ParticleAnimation.getWaveform(
                this.waveformType,
                ParticleAnimation.time * 2 + this.pulsePhase
            );
            const glowIntensity = 0.5 + pulse * 0.5;

            ParticleAnimation.ctx.save();

            /** @type {CanvasRenderingContext2D} */
            const gradient = ParticleAnimation.ctx.createLinearGradient(
                this.p1.x, this.p1.y,
                this.p2.x, this.p2.y
            );
            gradient.addColorStop(0, `rgba(${window.animationColor2}, ${this.life * glowIntensity})`);
            gradient.addColorStop(0.5, `rgba(${window.animationColor2}, ${this.life * 0.8 * glowIntensity})`);
            gradient.addColorStop(1, `rgba(${window.animationColor2}, ${this.life * glowIntensity})`);

            ParticleAnimation.ctx.beginPath();
            const currentSegments = Math.floor(this.segments * this.progress);

            if (currentSegments < 2) {
                ParticleAnimation.ctx.restore();
                return;
            }

            ParticleAnimation.ctx.moveTo(this.points[0].x, this.points[0].y);

            for (let i = 1; i < currentSegments; i++) {
                const xc = (this.points[i].x + this.points[i - 1].x) / 2;
                const yc = (this.points[i].y + this.points[i - 1].y) / 2;
                ParticleAnimation.ctx.quadraticCurveTo(
                    this.points[i - 1].x,
                    this.points[i - 1].y,
                    xc, yc
                );
            }

            if (currentSegments < this.segments) {
                const lastFull = this.points[currentSegments - 1];
                const nextPoint = this.points[currentSegments];
                if (nextPoint) {
                    const remaining = (this.progress * this.segments) - currentSegments;
                    ParticleAnimation.ctx.quadraticCurveTo(
                        lastFull.x,
                        lastFull.y,
                        lastFull.x + (nextPoint.x - lastFull.x) * remaining,
                        lastFull.y + (nextPoint.y - lastFull.y) * remaining
                    );
                }
            }

            ParticleAnimation.ctx.strokeStyle = gradient;
            ParticleAnimation.ctx.lineWidth = this.thickness * (1 + pulse * 0.3);
            ParticleAnimation.ctx.lineCap = 'round';
            ParticleAnimation.ctx.lineJoin = 'round';
            ParticleAnimation.ctx.stroke();

            ParticleAnimation.ctx.globalAlpha = this.life * 0.3;
            ParticleAnimation.ctx.filter = 'blur(4px)';
            ParticleAnimation.ctx.strokeStyle = `rgba(${window.animationColor2}), 0.5)`;
            ParticleAnimation.ctx.lineWidth = this.thickness * 2;
            ParticleAnimation.ctx.stroke();

            ParticleAnimation.ctx.globalAlpha = this.life * 0.7;
            ParticleAnimation.ctx.filter = 'none';
            ParticleAnimation.ctx.strokeStyle = `rgba(${window.animationColor2}), 0.8)`;
            ParticleAnimation.ctx.lineWidth = this.thickness * 0.5;
            ParticleAnimation.ctx.stroke();

            ParticleAnimation.ctx.restore();
        }
    }

    // ==================== Animation Management ====================
    initParticles() {
        this.particles = [];
        for (let i = 0; i < this.particleConfig.number; i++) {
            this.particles.push(new this.Particle());
        }
    }
    updateConnections() {
        for (let i = this.connections.length - 1; i >= 0; i--) {
            if (!this.connections[i].update()) {
                this.connections.splice(i, 1);
            }
        }

        while (this.connections.length < this.connectionConfig.maxConnections) {
            const p1 = this.particles[Math.floor(Math.random() * this.particles.length)];
            const p2 = this.particles[Math.floor(Math.random() * this.particles.length)];

            if (p1 === p2) continue;

            let exists = this.connections.some(conn =>
                (conn.p1 === p1 && conn.p2 === p2) ||
                (conn.p1 === p2 && conn.p2 === p1)
            );
            if (exists) continue;

            this.connections.push(new this.Connection(p1, p2));
        }
    }
    animate() {
        this.ctx.fillStyle = this.canvasConfig.backgroundColor;
        //this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        this.particles.forEach(particle => {
            particle.update();
            particle.draw();
        });

        this.updateConnections();
        this.connections.forEach(connection => connection.draw());

        this.time += this.animationConfig.timeIncrement;

        this.animationId = requestAnimationFrame(() => this.animate());
    }
    start() {
        if (!this.animationId) {
            this.animate();
        }
    }
    stop() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }
    reset() {
        this.stop();
        this.time = 0;
        this.particles = [];
        this.connections = [];
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
};

window.ParticleAnimation = ParticleAnimation;
