// Author: Aleksandr Albert
// Website: www.routter.co.tt

// Description: A deep water ocean shader set
// based on an implementation of a Tessendorf Waves
// originally presented by David Li ( www.david.li/waves )

// Modified by Ryusuke Sugimoto to compute reflection with the generated geometry

// The general method is to apply shaders to simulation Framebuffers
// and then sample these framebuffers when rendering the ocean mesh

// The set uses 7 shaders:

// -- Simulation shaders
// [1] ocean_sim_vertex         -> Vertex shader used to set up a 2x2 simulation plane centered at (0,0)
// [2] ocean_subtransform       -> Fragment shader used to subtransform the mesh (generates the displacement map)
// [3] ocean_initial_spectrum   -> Fragment shader used to set intitial wave frequency at a texel coordinate
// [4] ocean_phase              -> Fragment shader used to set wave phase at a texel coordinate
// [5] ocean_spectrum           -> Fragment shader used to set current wave frequency at a texel coordinate
// [6] ocean_normal             -> Fragment shader used to set face normals at a texel coordinate

// -- Rendering Shader
// [7] ocean_main               -> Vertex and Fragment shader used to create the final render

// Modified by Ryusuke Sugimoto

THREE.ShaderLib["ocean_sim_vertex"] = {
	vertexShader: `
		varying vec2 vUV;

		void main (void) {
			vUV = position.xy * 0.5 + 0.5;
			gl_Position = vec4(position, 1.0 );
		}
	`
};
THREE.ShaderLib["ocean_subtransform"] = {
	uniforms: {
		"u_input": { value: null },
		"u_transformSize": { value: 512.0 },
		"u_subtransformSize": { value: 250.0 }
	},
	fragmentShader: `
		//GPU FFT using a Stockham formulation

		precision highp float;
		#include <common>

		uniform sampler2D u_input;
		uniform float u_transformSize;
		uniform float u_subtransformSize;

		varying vec2 vUV;

		vec2 multiplyComplex (vec2 a, vec2 b) {
			return vec2(a[0] * b[0] - a[1] * b[1], a[1] * b[0] + a[0] * b[1]);
		}

		void main (void) {
			#ifdef HORIZONTAL
			float index = vUV.x * u_transformSize - 0.5;
			#else
			float index = vUV.y * u_transformSize - 0.5;
			#endif

			float evenIndex = floor(index / u_subtransformSize) * (u_subtransformSize * 0.5) + mod(index, u_subtransformSize * 0.5);

			//transform two complex sequences simultaneously
			#ifdef HORIZONTAL
			vec4 even = texture2D(u_input, vec2(evenIndex + 0.5, gl_FragCoord.y) / u_transformSize).rgba;
			vec4 odd = texture2D(u_input, vec2(evenIndex + u_transformSize * 0.5 + 0.5, gl_FragCoord.y) / u_transformSize).rgba;
			#else
			vec4 even = texture2D(u_input, vec2(gl_FragCoord.x, evenIndex + 0.5) / u_transformSize).rgba;
			vec4 odd = texture2D(u_input, vec2(gl_FragCoord.x, evenIndex + u_transformSize * 0.5 + 0.5) / u_transformSize).rgba;
			#endif

			float twiddleArgument = -2.0 * PI * (index / u_subtransformSize);
			vec2 twiddle = vec2(cos(twiddleArgument), sin(twiddleArgument));

			vec2 outputA = even.xy + multiplyComplex(twiddle, odd.xy);
			vec2 outputB = even.zw + multiplyComplex(twiddle, odd.zw);

			gl_FragColor = vec4(outputA, outputB);
		}
	`
};
THREE.ShaderLib["ocean_initial_spectrum"] = {
	uniforms: {
		"u_wind": { value: new THREE.Vector2(10.0, 10.0) },
		"u_resolution": { value: 512.0 },
		"u_size": { value: 250.0 }
	},
	fragmentShader: `
		precision highp float;
		#include <common>

		const float G = 9.81;
		const float KM = 370.0;
		const float CM = 0.23;

		uniform vec2 u_wind;
		uniform float u_resolution;
		uniform float u_size;

		float omega (float k) {
			return sqrt(G * k * (1.0 + pow2(k / KM)));
		}

		float _tanh (float x) {
			return (1.0 - exp(-2.0 * x)) / (1.0 + exp(-2.0 * x));
		}

		void main (void) {
			vec2 coordinates = gl_FragCoord.xy - 0.5;

			float n = (coordinates.x < u_resolution * 0.5) ? coordinates.x : coordinates.x - u_resolution;
			float m = (coordinates.y < u_resolution * 0.5) ? coordinates.y : coordinates.y - u_resolution;

			vec2 K = (2.0 * PI * vec2(n, m)) / u_size;
			float k = length(K);

			float l_wind = length(u_wind);

			float Omega = 0.84;
			float kp = G * pow2(Omega / l_wind);

			float c = omega(k) / k;
			float cp = omega(kp) / kp;

			float Lpm = exp(-1.25 * pow2(kp / k));
			float gamma = 1.7;
			float sigma = 0.08 * (1.0 + 4.0 * pow(Omega, -3.0));
			float Gamma = exp(-pow2(sqrt(k / kp) - 1.0) / 2.0 * pow2(sigma));
			float Jp = pow(gamma, Gamma);
			float Fp = Lpm * Jp * exp(-Omega / sqrt(10.0) * (sqrt(k / kp) - 1.0));
			float alphap = 0.006 * sqrt(Omega);
			float Bl = 0.5 * alphap * cp / c * Fp;

			float z0 = 0.000037 * pow2(l_wind) / G * pow(l_wind / cp, 0.9);
			float uStar = 0.41 * l_wind / log(10.0 / z0);
			float alpham = 0.01 * ((uStar < CM) ? (1.0 + log(uStar / CM)) : (1.0 + 3.0 * log(uStar / CM)));
			float Fm = exp(-0.25 * pow2(k / KM - 1.0));
			float Bh = 0.5 * alpham * CM / c * Fm * Lpm;

			float a0 = log(2.0) / 4.0;
			float am = 0.13 * uStar / CM;
			float Delta = _tanh(a0 + 4.0 * pow(c / cp, 2.5) + am * pow(CM / c, 2.5));

			float cosPhi = dot(normalize(u_wind), normalize(K));

			float S = (1.0 / (2.0 * PI)) * pow(k, -4.0) * (Bl + Bh) * (1.0 + Delta * (2.0 * cosPhi * cosPhi - 1.0));

			float dk = 2.0 * PI / u_size;
			float h = sqrt(S / 2.0) * dk;

			if (K.x == 0.0 && K.y == 0.0) {
				h = 0.0; //no DC term
			}
			gl_FragColor = vec4(h, 0.0, 0.0, 0.0);
		}
	`
};
THREE.ShaderLib["ocean_phase"] = {
	uniforms: {
		"u_phases": { value: null },
		"u_deltaTime": { value: null },
		"u_resolution": { value: null },
		"u_size": { value: null }
	},
	fragmentShader: `
		precision highp float;
		#include <common>

		const float G = 9.81;
		const float KM = 370.0;

		varying vec2 vUV;

		uniform sampler2D u_phases;
		uniform float u_deltaTime;
		uniform float u_resolution;
		uniform float u_size;

		float omega (float k) {
			return sqrt(G * k * (1.0 + k * k / KM * KM));
		}

		void main (void) {
			float deltaTime = 1.0 / 60.0;
			vec2 coordinates = gl_FragCoord.xy - 0.5;
			float n = (coordinates.x < u_resolution * 0.5) ? coordinates.x : coordinates.x - u_resolution;
			float m = (coordinates.y < u_resolution * 0.5) ? coordinates.y : coordinates.y - u_resolution;
			vec2 waveVector = (2.0 * PI * vec2(n, m)) / u_size;

			float phase = texture2D(u_phases, vUV).r;
			float deltaPhase = omega(length(waveVector)) * u_deltaTime;
			phase = mod(phase + deltaPhase, 2.0 * PI);

			gl_FragColor = vec4(phase, 0.0, 0.0, 0.0);
		}
	`
};
THREE.ShaderLib["ocean_spectrum"] = {
	uniforms: {
		"u_size": { value: null },
		"u_resolution": { value: null },
		"u_choppiness": { value: null },
		"u_phases": { value: null },
		"u_initialSpectrum": { value: null }
	},
	fragmentShader: `
		precision highp float;
		#include <common>

		const float G = 9.81;
		const float KM = 370.0;

		varying vec2 vUV;

		uniform float u_size;
		uniform float u_resolution;
		uniform float u_choppiness;
		uniform sampler2D u_phases;
		uniform sampler2D u_initialSpectrum;

		vec2 multiplyComplex (vec2 a, vec2 b) {
			return vec2(a[0] * b[0] - a[1] * b[1], a[1] * b[0] + a[0] * b[1]);
		}

		vec2 multiplyByI (vec2 z) {
			return vec2(-z[1], z[0]);
		}

		float omega (float k) {
			return sqrt(G * k * (1.0 + k * k / KM * KM));
		}

		void main (void) {
			vec2 coordinates = gl_FragCoord.xy - 0.5;
			float n = (coordinates.x < u_resolution * 0.5) ? coordinates.x : coordinates.x - u_resolution;
			float m = (coordinates.y < u_resolution * 0.5) ? coordinates.y : coordinates.y - u_resolution;
			vec2 waveVector = (2.0 * PI * vec2(n, m)) / u_size;

			float phase = texture2D(u_phases, vUV).r;
			vec2 phaseVector = vec2(cos(phase), sin(phase));

			vec2 h0 = texture2D(u_initialSpectrum, vUV).rg;
			vec2 h0Star = texture2D(u_initialSpectrum, vec2(1.0 - vUV + 1.0 / u_resolution)).rg;
			h0Star.y *= -1.0;

			vec2 h = multiplyComplex(h0, phaseVector) + multiplyComplex(h0Star, vec2(phaseVector.x, -phaseVector.y));

			vec2 hX = -multiplyByI(h * (waveVector.x / length(waveVector))) * u_choppiness;
			vec2 hZ = -multiplyByI(h * (waveVector.y / length(waveVector))) * u_choppiness;

			//no DC term
			if (waveVector.x == 0.0 && waveVector.y == 0.0) {
				h = vec2(0.0);
				hX = vec2(0.0);
				hZ = vec2(0.0);
			}

			gl_FragColor = vec4(hX + multiplyByI(h), hZ);
		}
	`
};
THREE.ShaderLib["ocean_normals"] = {
	uniforms: {
		"u_displacementMap": { value: null },
		"u_resolution": { value: null },
		"u_size": { value: null }
	},
	fragmentShader: `
		precision highp float;

		varying vec2 vUV;

		uniform sampler2D u_displacementMap;
		uniform float u_resolution;
		uniform float u_size;

		void main (void) {
			float texel = 1.0 / u_resolution;
			float texelSize = u_size / u_resolution;

			vec3 center = texture2D(u_displacementMap, vUV).rgb;
			vec3 right = vec3(texelSize, 0.0, 0.0) + texture2D(u_displacementMap, vUV + vec2(texel, 0.0)).rgb - center;
			vec3 left = vec3(-texelSize, 0.0, 0.0) + texture2D(u_displacementMap, vUV + vec2(-texel, 0.0)).rgb - center;
			vec3 top = vec3(0.0, 0.0, -texelSize) + texture2D(u_displacementMap, vUV + vec2(0.0, -texel)).rgb - center;
			vec3 bottom = vec3(0.0, 0.0, texelSize) + texture2D(u_displacementMap, vUV + vec2(0.0, texel)).rgb - center;

			vec3 topRight = cross(right, top);
			vec3 topLeft = cross(top, left);
			vec3 bottomLeft = cross(left, bottom);
			vec3 bottomRight = cross(bottom, right);

			gl_FragColor = vec4(normalize(topRight + topLeft + bottomLeft + bottomRight), 1.0);
		}
	`
};

const num_spheres = 16;

THREE.ShaderLib["ocean_main"] = {
	uniforms: {
		"u_displacementMap": { value: null },
		"u_normalMap": { value: null },
		"u_reflectionTextures": { type: 'tv', value: null },
		"u_texture_interpolation": { value: null },
		"u_maskTexture": { value: null },
		"u_collisionCoordTexture": { value: null },

		"u_geometrySize": { value: null },
		"u_size": { value: null },

		"u_vpMatrix": { value: null },
		"u_vpMatrixInverse": { value: null },
		"u_cameraPosition": { value: null },
		"u_cameraNear": { value: null },
		"u_cameraFar": { value: null },

		"u_oceanColor": { value: null },
		"u_shConstants": { value: null },

		"u_resolution": { value: 1024.0 },
		"u_screenResolution": { value: null },
		"u_imageSize": { value: null },
		"u_devicePixelRatio": { value: window.devicePixelRatio },

		"u_centerShift": { value: null },
		"u_zoomFactor": { value: null },

		"u_showReflection": { value: false },
		"u_showUVCoord": { value: false },

		"u_sphere_centers": { value: null },
		"u_sphere_radii": { value: null },
		"u_sphere_rotations": { value: null }

	},
	vertexShader: `
        precision highp float;

        varying vec3 vPos;
        varying vec2 vUV;

        uniform mat4 u_vpMatrix;
        uniform mat4 u_vpMatrixInverse;
        uniform float u_size;
        uniform float u_geometrySize;
        uniform sampler2D u_displacementMap;

        void main (void) {
			vec4 worldRayEnd1 = u_vpMatrixInverse * vec4( position.xy, -1.0, 1.0);
			vec4 worldRayEnd2 = u_vpMatrixInverse * vec4( position.xy, 1.0, 1.0);
			worldRayEnd1.xyz = worldRayEnd1.xyz/worldRayEnd1.w;
			worldRayEnd2.xyz = worldRayEnd2.xyz/worldRayEnd2.w;
			vec3 geometryPos = (worldRayEnd1.xyz*worldRayEnd2.y - worldRayEnd2.xyz*worldRayEnd1.y)/(worldRayEnd2.y-worldRayEnd1.y);

			vec2 uv = geometryPos.xz/u_size;
			vec3 newPos = geometryPos + texture2D(u_displacementMap, uv).rgb;// * (u_geometrySize / u_size);

			vPos = newPos;
			vUV = uv;
			gl_Position = (worldRayEnd1.y-worldRayEnd2.y>0.0)? u_vpMatrix * vec4(newPos, 1.0):vec4(2.0,2.0,2.0,1.0);
        }
	`,
	//fragmentShader2 is the original shader program, which is not used in this application. It performs ray marching every frame.
	//I keep it here mainly for debug purpose.
	fragmentShader2: `
	precision highp float;

	const int MAX_TEXTURE_NUM=8;

	varying vec3 vPos;
	varying vec2 vUV;

	uniform mat4 u_vpMatrix;
	uniform mat4 u_vpMatrixInverse;
	uniform vec3 u_cameraPosition;

	uniform vec3 u_oceanColor;
	uniform vec3 u_shConstants[9];

	uniform sampler2D u_normalMap;
	uniform sampler2D u_reflectionTextures[MAX_TEXTURE_NUM];
	uniform float u_texture_interpolation;
	uniform sampler2D u_maskTexture;
	uniform sampler2D u_collisionCoordTexture;

	uniform vec2 u_screenResolution;
	uniform float u_devicePixelRatio;
	uniform vec2 u_imageSize;

	uniform vec2 u_centerShift;
	uniform float u_zoomFactor;

	uniform bool u_showReflection;
	uniform bool u_showUVCoord;

	const float PI = 3.1415926535897932384626433832795;
	const float MASK_THRESHOLD = 0.5;
	const int iterationNo = 540;
	const int MAX_BOUNDARIES = 5;

	vec4 texture2D_interpolate(sampler2D textures[MAX_TEXTURE_NUM], vec2 coord) {
		vec4 values[MAX_TEXTURE_NUM];
		values[0] = texture2D(textures[0], coord);
		values[1] = texture2D(textures[1], coord);
		values[2] = texture2D(textures[2], coord);
		values[3] = texture2D(textures[3], coord);
		values[4] = texture2D(textures[4], coord);
		values[5] = texture2D(textures[5], coord);
		values[6] = texture2D(textures[6], coord);
		values[7] = texture2D(textures[7], coord);

		vec4 val1 = values[int(floor(u_texture_interpolation))];
		vec4 val2 = values[int(ceil(u_texture_interpolation))];
		return (ceil(u_texture_interpolation)-u_texture_interpolation) * val1 + (1.0-(ceil(u_texture_interpolation)-u_texture_interpolation)) * val2;
	}

	bool textureCoordOutOfRange(vec2 coord){
		return any(greaterThan(abs(coord-0.5),vec2(0.5)));
	}

	vec2 currentWindowToInitialWindowCoordinates(vec2 point){
		return u_centerShift+(point-0.5)/u_zoomFactor;
	}

	vec2 initialWindowToImageCoordinates(vec2 point){
		float imageRatio = u_imageSize.x/u_imageSize.y;
		float displayRatio = u_screenResolution.x/u_screenResolution.y;
		float ratio = displayRatio/imageRatio;
		return (ratio>1.0)? vec2((point.x-0.5)*ratio+0.5,point.y):vec2(point.x,(point.y-0.5)/ratio+0.5);
	}

	vec2 windowToImageCoordinatesVector(vec2 vec){
		float imageRatio = u_imageSize.x/u_imageSize.y;
		float displayRatio = u_screenResolution.x/u_screenResolution.y;
		return vec2(vec.x*imageRatio/displayRatio,vec.y);
	}

	vec2 imageToCurrentWindowCoordinates(vec2 point){
		float imageRatio = u_imageSize.x/u_imageSize.y;
		float displayRatio = u_screenResolution.x/u_screenResolution.y;
		float ratio = displayRatio/imageRatio;
		point = (ratio > 1.0)? vec2((point.x-0.5)/ratio+0.5,point.y):vec2(point.x,(point.y-0.5)*ratio+0.5);
		return (point-u_centerShift)*u_zoomFactor+vec2(0.5);
	}

	float getMaskVal(vec2 coord){
		if(textureCoordOutOfRange(coord)) return 0.0;
		else return texture2D(u_maskTexture, coord).r;
	}

	int getBoundaryPoints(vec2 rayPoint, vec2 rayVector, inout vec2 boundaryPoints[MAX_BOUNDARIES]){
		rayPoint = currentWindowToInitialWindowCoordinates(rayPoint);
		rayVector = rayVector*(1.0-rayPoint.y)*1.1/float(iterationNo);
		rayPoint = initialWindowToImageCoordinates(rayPoint);
		rayVector = windowToImageCoordinatesVector(rayVector);

		int boundaries_found = 0;
		bool inside_object = false;
		for(int i=0; i< iterationNo; i++){
			rayPoint = rayPoint + rayVector;
			float mask_val = getMaskVal(rayPoint);
			if(mask_val < MASK_THRESHOLD) {
				if(inside_object) continue;
				inside_object=true;
				boundaryPoints[boundaries_found++] = rayPoint;
				if(boundaries_found==MAX_BOUNDARIES) break;
			}else {
				inside_object=false;
			}
		}

		for (int i=0; i<MAX_BOUNDARIES; i++){
			if (i==boundaries_found) break;
			boundaryPoints[i] = imageToCurrentWindowCoordinates(boundaryPoints[i]);
		}
		return boundaries_found;
	}

	int getCollisionPoints(vec2 rayPoint, vec2 rayVector, inout vec2 collisionPoints[MAX_BOUNDARIES]) {
		rayPoint = rayPoint*0.5+0.5;
		int boundaries_found = getBoundaryPoints(rayPoint, rayVector, collisionPoints);
		for (int i=0; i<MAX_BOUNDARIES; i++) collisionPoints[i] = collisionPoints[i]*2.0-1.0;
		return boundaries_found;
	}

	vec3 sh(vec3 vec){
		const float pi = 3.14159265358979;
		float shBasis[9];
		shBasis[0] = 1.0/sqrt(4.0*pi);
		shBasis[1] = sqrt(3.0/(4.0*pi))*vec.z;
		shBasis[2] = sqrt(3.0/(4.0*pi))*vec.x;
		shBasis[3] = sqrt(3.0/(4.0*pi))*vec.y;
		shBasis[4] = 0.5*sqrt(5.0/(4.0*pi))*(3.0*vec.z*vec.z-1.0);
		shBasis[5] = 3.0*sqrt(5.0/(12.0*pi))*vec.x*vec.z;
		shBasis[6] = 3.0*sqrt(5.0/(12.0*pi))*vec.y*vec.z;
		shBasis[7] = 1.5*sqrt(5.0/(12.0*pi))*(vec.x*vec.x-vec.y*vec.y);
		shBasis[8] = 3.0*sqrt(5.0/(12.0*pi))*vec.x*vec.y;
		vec3 res = vec3(0.0, 0.0, 0.0);
		for(int i=0; i<9; i++){
			res += shBasis[i]*u_shConstants[i];
		}
		return res;
	}

	vec3 getReflectionValue(vec2 currentWindowCoord){
		vec2 currentWindowCoordNormalized = currentWindowCoord*0.5 + 0.5;
		vec2 initialWindowCoord = currentWindowToInitialWindowCoordinates(currentWindowCoordNormalized);
		vec2 imageCoord = initialWindowToImageCoordinates(initialWindowCoord);
		
		imageCoord = clamp(imageCoord, 0.0, 1.0);
		return texture2D_interpolate(u_reflectionTextures, imageCoord).rgb;
	}

	vec3 getRayPlaneIntersectionPoint(vec2 position){
		vec4 worldRayEnd1 = u_vpMatrixInverse * vec4( position.xy, -1.0, 1.0);
		vec4 worldRayEnd2 = u_vpMatrixInverse * vec4( position.xy, 1.0, 1.0);
		worldRayEnd1.xyz = worldRayEnd1.xyz/worldRayEnd1.w;
		worldRayEnd2.xyz = worldRayEnd2.xyz/worldRayEnd2.w;
		vec3 geometryPos = (worldRayEnd1.xyz*worldRayEnd2.y - worldRayEnd2.xyz*worldRayEnd1.y)/(worldRayEnd2.y-worldRayEnd1.y);
		return geometryPos;
	}

	vec2 worldToWindowCoordinates(vec3 pos){
		vec4 temp = u_vpMatrix * vec4(pos, 1.0);
		return temp.xy/temp.w;
	}

	//Calculate reflection vector
	//Project the reflection vector to display coordinate
	//If the reflection vector is not pointing upward on display, return default colour
	//calculate the point on which the ray collides with the boundary
	//map the display coordinate vector back to the 3D space
	//Fetch the texture coordinate using the camera position and the position of collision
	//Clamp / change it with sky color if it is out of texture coordinate
	//return the color,
	vec3 getReflectionColor(vec3 normal, vec3 view){
		float incidenceAngle = dot(normal, view);
		vec3 reflectionVector = normalize(2.0*incidenceAngle*normal - view);
		vec3 shReflection = sh(reflectionVector);
		vec2 fragCoord = (gl_FragCoord.xy/(u_devicePixelRatio*u_screenResolution))*2.0-1.0;

		vec4 temp = u_vpMatrix * vec4(vPos+reflectionVector,1.0);
		vec2 reflectionVectorDisplay = (temp.xy / temp.w) - fragCoord.xy;
		float rayAngle = atan(reflectionVectorDisplay.x/reflectionVectorDisplay.y); //[-75,75] -> ok
		reflectionVectorDisplay /= abs(reflectionVectorDisplay.y);

		// if(reflectionVectorDisplay.y < 0.0 || rayAngle <(-5.0*PI/12.0) || rayAngle >(5.0*PI/12.0)) return shReflection;
		rayAngle = clamp(rayAngle, -5.0*PI/12.0, 5.0*PI/12.0);

		vec2 boundaryPointsDisplay[MAX_BOUNDARIES];
		int boundaries_found = getCollisionPoints(fragCoord, reflectionVectorDisplay, boundaryPointsDisplay);
		// boundaries_found = 1;

		vec3 reflectionSource;
		for (int i=0; i<MAX_BOUNDARIES; i++) {
			vec3 boundaryPoint = getRayPlaneIntersectionPoint(boundaryPointsDisplay[i]);
			reflectionSource = vPos + reflectionVector*((boundaryPoint.z - vPos.z)/reflectionVector.z);
			if (i==boundaries_found-1) break;
			vec2 reflectionSource2D = worldToWindowCoordinates(reflectionSource);
			vec2 texCoord = initialWindowToImageCoordinates(currentWindowToInitialWindowCoordinates(reflectionSource2D*0.5+0.5));
			if (getMaskVal(texCoord) < MASK_THRESHOLD) break;
		}

		vec3 sourceToReflectionPoint = vec3(0.0, -u_cameraPosition.y, 0.0) - reflectionSource;
		sourceToReflectionPoint /= -sourceToReflectionPoint.y;
		vec3 texturePos3D = reflectionSource + sourceToReflectionPoint * reflectionSource.y;
		temp = u_vpMatrix * vec4(texturePos3D.x, 0.0, texturePos3D.z, 1.0);
		vec2 textureCoord = temp.xy/temp.w;

		vec3 pureReflection = getReflectionValue(textureCoord);
		float weight = 0.8;
		return weight*pureReflection+(1.0-weight)*shReflection;
	}

	void main (void) {
		vec2 fragPosCurrentWindowCoord = gl_FragCoord.xy/(u_devicePixelRatio*u_screenResolution);
		vec2 fragPosInitialWindowCoord = currentWindowToInitialWindowCoordinates(fragPosCurrentWindowCoord);
		vec2 fragPosImageCoord = initialWindowToImageCoordinates(fragPosInitialWindowCoord);
		if(any(greaterThan(abs(fragPosImageCoord-0.5),vec2(0.5)))) discard;

		float opacity = texture2D(u_maskTexture, fragPosImageCoord).r;
		if(opacity <= 0.0) discard;

		if(u_showUVCoord){
			gl_FragColor = vec4(fract(vUV+vec2(0.5,0.0)).rg, 0.0,  opacity);
			return;
		}

		vec3 normal = normalize(texture2D(u_normalMap, vUV).xyz);
		vec3 view = normalize(u_cameraPosition - vPos);
		float incidenceAngle = dot(normal, view);
		float fresnel = 0.02 + 0.98 * pow(1.0 - incidenceAngle, 5.0);

		vec3 reflectionColor = getReflectionColor(normal,view);
		vec3 color = u_showReflection? reflectionColor:reflectionColor*(fresnel+(1.0-fresnel)*u_oceanColor);
		gl_FragColor = vec4(color, opacity);
	}
	`,
	fragmentShader: `
	precision highp float;

	varying vec3 vPos;
	varying vec2 vUV;

	const int MAX_TEXTURE_NUM=8;

	uniform mat4 u_vpMatrix;
	uniform mat4 u_vpMatrixInverse;
	uniform vec3 u_cameraPosition;
	uniform float u_cameraNear;
	uniform float u_cameraFar;

	uniform vec3 u_oceanColor;
	uniform vec3 u_shConstants[9];

	uniform sampler2D u_normalMap;
	uniform sampler2D u_reflectionTextures[MAX_TEXTURE_NUM];
	uniform float u_texture_interpolation;
	uniform sampler2D u_maskTexture;
	uniform sampler2D u_collisionCoordTexture;

	uniform vec2 u_screenResolution;
	uniform float u_devicePixelRatio;
	uniform vec2 u_imageSize;

	uniform vec2 u_centerShift;
	uniform float u_zoomFactor;

	uniform bool u_showReflection;
	uniform bool u_showUVCoord;

	uniform vec3 u_sphere_centers[${num_spheres}];
	uniform float u_sphere_radii[${num_spheres}];
	uniform mat4 u_sphere_rotations[${num_spheres}];

	uniform float u_size;
	uniform sampler2D u_displacementMap;

	const float PI = 3.1415926535897932384626433832795;
	const float MASK_THRESHOLD = 0.5;

	vec4 texture2D_interpolate(sampler2D textures[MAX_TEXTURE_NUM], vec2 coord) {
		vec4 values[MAX_TEXTURE_NUM];
		values[0] = texture2D(textures[0], coord);
		values[1] = texture2D(textures[1], coord);
		values[2] = texture2D(textures[2], coord);
		values[3] = texture2D(textures[3], coord);
		values[4] = texture2D(textures[4], coord);
		values[5] = texture2D(textures[5], coord);
		values[6] = texture2D(textures[6], coord);
		values[7] = texture2D(textures[7], coord);

		vec4 val1 = values[int(floor(u_texture_interpolation))];
		vec4 val2 = values[int(ceil(u_texture_interpolation))];
		return (ceil(u_texture_interpolation)-u_texture_interpolation) * val1 + (1.0-(ceil(u_texture_interpolation)-u_texture_interpolation)) * val2;
	}

	vec2 initialWindowToImageCoordinates(vec2 point){
		float imageRatio = u_imageSize.x/u_imageSize.y;
		float displayRatio = u_screenResolution.x/u_screenResolution.y;
		float ratio = displayRatio/imageRatio;
		return (ratio>1.0)? vec2((point.x-0.5)*ratio+0.5,point.y):vec2(point.x,(point.y-0.5)/ratio+0.5);
	}

	vec2 currentWindowToInitialWindowCoordinates(vec2 point){
		return u_centerShift+(point-0.5)/u_zoomFactor;
	}
	
	vec3 sh(vec3 vec){
		const float pi = 3.14159265358979;
		float shBasis[9];
		shBasis[0] = 1.0/sqrt(4.0*pi);
		shBasis[1] = sqrt(3.0/(4.0*pi))*vec.z;
		shBasis[2] = sqrt(3.0/(4.0*pi))*vec.x;
		shBasis[3] = sqrt(3.0/(4.0*pi))*vec.y;
		shBasis[4] = 0.5*sqrt(5.0/(4.0*pi))*(3.0*vec.z*vec.z-1.0);
		shBasis[5] = 3.0*sqrt(5.0/(12.0*pi))*vec.x*vec.z;
		shBasis[6] = 3.0*sqrt(5.0/(12.0*pi))*vec.y*vec.z;
		shBasis[7] = 1.5*sqrt(5.0/(12.0*pi))*(vec.x*vec.x-vec.y*vec.y);
		shBasis[8] = 3.0*sqrt(5.0/(12.0*pi))*vec.x*vec.y;
		vec3 res = vec3(0.0, 0.0, 0.0);
		for(int i=0; i<9; i++){
			res += shBasis[i]*u_shConstants[i];
		}
		return res;
	}

	const int NUM_POINTS = 9;
	const int NUM_POINTS_SQRT = 3;
	const int THRESHOLD = 5;
	vec2 filter_points(vec4 points[NUM_POINTS], float weights[NUM_POINTS]) {
		float weight_sum = 0.0;
		int valid_count = 0;
		vec2 result = vec2(0.0);
		float current_weight = weights[0];
		for (int i=0; i<NUM_POINTS; i++) {
			if (all(equal(points[i].xy, vec2(-2.0)))) continue;
			valid_count++;
			weight_sum += weights[i];
			result += points[i].xy*weights[i];
		}
		if (valid_count >= THRESHOLD) return result/weight_sum;
		else return vec2(-2.0);
	}

	vec4 loadCollisionCoord(vec2 pixel_pos, vec2 pixel_size, float shift_x, float shift_y) {
		vec4 coord = texture2D(u_collisionCoordTexture, pixel_pos + vec2(pixel_size.x*shift_x, pixel_size.y*shift_y));
		if (!all(equal(coord.xy, vec2(-2.0)))) {
			coord.x -= pixel_size.x*shift_x;
		}
		return coord;
	}


	vec4 getCollisionPoints(){
		vec2 pixel_size = 1.0/(u_screenResolution*u_devicePixelRatio);
		vec2 pixel_pos = gl_FragCoord.xy/(u_screenResolution*u_devicePixelRatio);
		return texture2D(u_collisionCoordTexture, pixel_pos);

		vec4 coords[NUM_POINTS];
		float weights[NUM_POINTS];
		for (int i=0; i<=NUM_POINTS_SQRT; i++) {
			for (int j=0; j<=NUM_POINTS_SQRT; j++) {
				float x_shift = float(i-(NUM_POINTS_SQRT/2));
				float y_shift = float(j-(NUM_POINTS_SQRT/2));
				coords[NUM_POINTS_SQRT*i+j] = loadCollisionCoord(pixel_pos, pixel_size, x_shift, y_shift);
				weights[NUM_POINTS_SQRT*i+j] = 1.0; //pow(float(NUM_POINTS_SQRT/2) - x_shift, 2.) + pow(float(NUM_POINTS_SQRT/2) - y_shift, 2.);
			}
		}
	
		vec2 coord_xy = filter_points(coords, weights);
		return vec4(coord_xy, coords[0].zw);
	}

	vec3 getReflectionValue(vec2 currentWindowCoord){
		vec2 currentWindowCoordNormalized = currentWindowCoord*0.5 + 0.5;
		vec2 initialWindowCoord = currentWindowToInitialWindowCoordinates(currentWindowCoordNormalized);
		vec2 imageCoord = initialWindowToImageCoordinates(initialWindowCoord);
		
		imageCoord = clamp(imageCoord, 0.0, 1.0);
		return texture2D_interpolate(u_reflectionTextures, imageCoord).rgb;
	}

	vec3 getRayPlaneIntersectionPoint(vec2 position){
		vec4 worldRayEnd1 = u_vpMatrixInverse * vec4( position.xy, -1.0, 1.0);
		vec4 worldRayEnd2 = u_vpMatrixInverse * vec4( position.xy, 1.0, 1.0);
		worldRayEnd1.xyz = worldRayEnd1.xyz/worldRayEnd1.w;
		worldRayEnd2.xyz = worldRayEnd2.xyz/worldRayEnd2.w;
		vec3 geometryPos = (worldRayEnd1.xyz*worldRayEnd2.y - worldRayEnd2.xyz*worldRayEnd1.y)/(worldRayEnd2.y-worldRayEnd1.y);
		return geometryPos;
	}

	vec2 worldToWindowCoordinates(vec3 pos){
		vec4 temp = u_vpMatrix * vec4(pos, 1.0);
		return temp.xy/temp.w;
	}

	bool textureCoordOutOfRange(vec2 coord){
		return any(greaterThan(abs(coord-0.5),vec2(0.5)));
	}

	float getMaskVal(vec2 coord){
		if(textureCoordOutOfRange(coord)) return 0.0;
		else return texture2D(u_maskTexture, coord).r;
	}

 	vec3 getBeachBallColor(vec3 normal) {
		const float pi = 3.14159265358979;
		const vec3 colors[] = vec3[](
			vec3(251./255., 70./255., 65./255.), //red
			vec3(253./255., 148./255., 45./255.), //orange
			vec3(255./255., 201./255., 54./255.), //yellow
			vec3(68./255., 180./255., 49./255.), //green
			vec3(18./255., 146./255., 237./255.), //blue
			vec3(174./255., 90./255., 199./255.), //purple
			vec3(40./255., 118./255., 228./255.) //dark blue
		);
		float theta = acos(normal.y);
		float phi = atan(normal.z, normal.x);
		if (theta<pi*0.1 || theta>0.9*pi) return colors[6];
		return colors[int(6. * (0.5+phi/(2.*pi)))];
	}

	float raySphereIntersection(vec3 ray_src, vec3 ray_dir, vec3 sphere_center, float sphere_radius) {
		float a = dot(ray_dir, ray_dir);
		float b = 2.*dot(ray_src-sphere_center, ray_dir);
		float c = dot(ray_src-sphere_center, ray_src-sphere_center) - sphere_radius*sphere_radius;

		float discriminant = b*b - 4.0*a*c;

		if (discriminant<=0.0) return -1.0;

		float t1 = (- b + sqrt(discriminant))/(2.*a);
		float t2 = (- b - sqrt(discriminant))/(2.*a);

		if (t1<=0.0 && t2>0.0) return t2;
		else if (t2<=0.0 && t1>0.0) return t1;
		else {
			if (t1<t2) return t1;
			else return t2;
		}
	}


	//Calculate reflection vector
	//Project the reflection vector to display coordinate
	//If the reflection vector is not pointing upward on display, return default colour
	//calculate the point on which the ray collides with the boundary
	//map the display coordinate vector back to the 3D space
	//Fetch the texture coordinate using the camera position and the position of collision
	//Clamp / change it with sky color if it is out of texture coordinate
	//return the color,
	vec3 getReflectionColor(vec3 normal, vec3 view){
		float incidenceAngle = dot(normal, view);
		vec3 reflectionVector = normalize(2.0*incidenceAngle*normal - view);
		vec3 shReflection = sh(reflectionVector);
		vec2 fragCoord = (gl_FragCoord.xy/(u_devicePixelRatio*u_screenResolution))*2.0-1.0;

		int sphere_idx = -1;
		float min_t = - 1.0;
		vec3 sphere_center;
		for (int i=0; i<${num_spheres}; i++) {
			vec3 _sphere_center = u_sphere_centers[i] + texture2D(u_displacementMap, u_sphere_centers[i].xz/u_size).rgb;
			float t = raySphereIntersection(vPos, reflectionVector, _sphere_center, u_sphere_radii[i]);
			if (t>=0.0 && (t<min_t || sphere_idx==-1)) {
				sphere_idx = i;
				min_t = t;
				sphere_center = _sphere_center;
			}
		}
		if (min_t>=0.){
			vec3 sphere_normal = normalize((vPos + min_t*reflectionVector) - sphere_center);
			vec3 sh_color = sh(vec3(sphere_normal.x, max(sphere_normal.y, 0.0), sphere_normal.z));
			vec3 sphere_normal_object = vec3(u_sphere_rotations[sphere_idx] * vec4(sphere_normal, 0.0));
			vec3 object_color = getBeachBallColor(sphere_normal_object);
			return (sh_color*0.5+vec3(0.5))*object_color;
		}

		vec4 temp = u_vpMatrix * vec4(vPos+reflectionVector,1.0);
		vec2 reflectionVectorDisplay = (temp.xy / temp.w) - fragCoord.xy;
		float rayAngle = atan(reflectionVectorDisplay.x/reflectionVectorDisplay.y); //[-75,75] -> ok
		reflectionVectorDisplay /= abs(reflectionVectorDisplay.y);

		// if(reflectionVectorDisplay.y < 0.0 || rayAngle <(-5.0*PI/12.0) || rayAngle >(5.0*PI/12.0)) return shReflection;
		rayAngle = clamp(rayAngle, -5.0*PI/12.0, 5.0*PI/12.0);
		vec4 boundaryPointsDisplay =  getCollisionPoints();
		vec3 pureReflections[2];
		float first_reflection_ratio;
		for (int i=0; i<2; i++) {
			if(i==0 && all(equal(boundaryPointsDisplay.xy,vec2(-2.0)))) {
				first_reflection_ratio = 0.0;
				continue;
			}else if (i==1 && first_reflection_ratio==1.0){
				continue;
			}
			vec2 boundaryPointDisplay = i==0?boundaryPointsDisplay.xy :boundaryPointsDisplay.zw;
			vec3 boundaryPoint = getRayPlaneIntersectionPoint(boundaryPointDisplay);
			vec3 reflectionSource = vPos + reflectionVector*((boundaryPoint.z - vPos.z)/reflectionVector.z);
			vec2 reflectionSource2D = worldToWindowCoordinates(reflectionSource);
			vec2 texCoord = initialWindowToImageCoordinates(currentWindowToInitialWindowCoordinates(reflectionSource2D*0.5+0.5));
			if (i==0) {
				first_reflection_ratio = 1.0-getMaskVal(texCoord);
				first_reflection_ratio = first_reflection_ratio < 0.5? 0.0:1.0;
			}


			vec3 sourceToReflectionPoint = vec3(u_cameraPosition.x, -u_cameraPosition.y, u_cameraPosition.z) - reflectionSource;
			sourceToReflectionPoint /= -sourceToReflectionPoint.y;
			vec3 texturePos3D = reflectionSource + sourceToReflectionPoint * reflectionSource.y;
			temp = u_vpMatrix * vec4(texturePos3D.x, 0.0, texturePos3D.z, 1.0);
			vec2 textureCoord = temp.xy/temp.w;

			pureReflections[i] = getReflectionValue(textureCoord);
		}
		vec3 pureReflection = pureReflections[0]*first_reflection_ratio + pureReflections[1]*(1.-first_reflection_ratio);
		
		float weight = 0.8;
		return weight*pureReflection+(1.0-weight)*shReflection;
	}

	vec3 getRefractionColor(vec3 normal, vec3 view){
		float cosIncidenceAngle = dot(normal, view);
		//refraction index for water is 4/3.
		vec3 refractionVector = normalize((3./4.) * (cosIncidenceAngle * normal - view) - normal * cosIncidenceAngle);//* sqrt(1.- (9./16.)*(1.-cosIncidenceAngle*cosIncidenceAngle)));
		int sphere_idx = -1;
		float min_t = - 1.0;
		vec3 sphere_center;
		for (int i=0; i<${num_spheres}; i++) {
			vec3 _sphere_center = u_sphere_centers[i] + texture2D(u_displacementMap, u_sphere_centers[i].xz/u_size).rgb;
			float t = raySphereIntersection(vPos, refractionVector, _sphere_center, u_sphere_radii[i]);
			if (t>=0.0 && (t<min_t || sphere_idx==-1)) {
				sphere_idx = i;
				min_t = t;
				sphere_center = _sphere_center;
			}
		}
		if (min_t>=0.){
			vec3 sphere_normal = normalize((vPos + min_t*refractionVector) - sphere_center);
			vec3 sh_color = sh(vec3(sphere_normal.x, max(sphere_normal.y, 0.0), sphere_normal.z));
			vec3 sphere_normal_object = vec3(u_sphere_rotations[sphere_idx] * vec4(sphere_normal, 0.0));
			vec3 object_color = getBeachBallColor(sphere_normal_object);
			return (sh_color*0.5+vec3(0.5))*object_color;
		}
		return u_oceanColor;
	}

	void main (void) {
		vec2 fragPosCurrentWindowCoord = gl_FragCoord.xy/(u_devicePixelRatio*u_screenResolution);
		vec2 fragPosInitialWindowCoord = currentWindowToInitialWindowCoordinates(fragPosCurrentWindowCoord);
		vec2 fragPosImageCoord = initialWindowToImageCoordinates(fragPosInitialWindowCoord);
		if(any(greaterThan(abs(fragPosImageCoord-0.5),vec2(0.5)))) discard;

		float opacity = texture2D(u_maskTexture, fragPosImageCoord).r;
		if(opacity <= 0.0) discard;

		if(u_showUVCoord){
			gl_FragColor = vec4(fract(vUV+vec2(0.5,0.0)).rg, 0.0,  opacity);
			return;
		}

		vec3 normal = normalize(texture2D(u_normalMap, vUV).xyz);
		vec3 view = normalize(u_cameraPosition - vPos);
		float incidenceAngle = dot(normal, view);
		float fresnel = 0.02 + 0.98 * pow(1.0 - incidenceAngle, 5.0);

		vec3 reflectionColor = getReflectionColor(normal,view);
		vec3 color = u_showReflection? reflectionColor:reflectionColor*(fresnel+(1.0-fresnel)*getRefractionColor(normal, view));
		gl_FragColor = vec4(color, opacity);
	}
	`
};

THREE.ShaderLib["ocean_filterBoundaryRayCollision"] = {
	uniforms: {
		"u_displacementMap": { value: null },
		"u_normalMap": { value: null },
		"u_maskTexture": { value: null },
		"u_collisionCoordTexture": { value: null },

		"u_geometrySize": { value: null },
		"u_size": { value: null },

		"u_vpMatrix": { value: null },
		"u_vpMatrixInverse": { value: null },
		"u_cameraPosition": { value: null },

		"u_resolution": { value: 1024.0 },
		"u_screenResolution": { value: null },
		"u_imageSize": { value: null },
		"u_devicePixelRatio": { value: window.devicePixelRatio },

		"u_centerShift": { value: null },
		"u_zoomFactor": { value: null },

	},
	vertexShader: `
        precision highp float;

        varying vec3 vPos;
        varying vec2 vUV;

        uniform mat4 u_vpMatrix;
        uniform mat4 u_vpMatrixInverse;
        uniform float u_size;
        uniform float u_geometrySize;
        uniform sampler2D u_displacementMap;

        void main (void) {
			vec4 worldRayEnd1 = u_vpMatrixInverse * vec4( position.xy, -1.0, 1.0);
			vec4 worldRayEnd2 = u_vpMatrixInverse * vec4( position.xy, 1.0, 1.0);
			worldRayEnd1.xyz = worldRayEnd1.xyz/worldRayEnd1.w;
			worldRayEnd2.xyz = worldRayEnd2.xyz/worldRayEnd2.w;
			vec3 geometryPos = (worldRayEnd1.xyz*worldRayEnd2.y - worldRayEnd2.xyz*worldRayEnd1.y)/(worldRayEnd2.y-worldRayEnd1.y);

			vec2 uv = geometryPos.xz/u_size;
			vec3 newPos = geometryPos + texture2D(u_displacementMap, uv).rgb;// * (u_geometrySize / u_size);

			vPos = newPos;
			vUV = uv;
			gl_Position = (worldRayEnd1.y-worldRayEnd2.y>0.0)? u_vpMatrix * vec4(newPos, 1.0):vec4(2.0,2.0,2.0,1.0);
		}
	`,
	fragmentShader: `
	precision highp float;

	varying vec3 vPos;
	varying vec2 vUV;

	uniform mat4 u_vpMatrix;
	uniform mat4 u_vpMatrixInverse;
	uniform vec3 u_cameraPosition;

	uniform sampler2D u_normalMap;
	uniform sampler2D u_maskTexture;
	uniform sampler2D u_collisionCoordTexture;

	uniform vec2 u_screenResolution;
	uniform float u_devicePixelRatio;
	uniform vec2 u_imageSize;

	uniform vec2 u_centerShift;
	uniform float u_zoomFactor;

	const float PI = 3.1415926535897932384626433832795;
	const float MASK_THRESHOLD = 0.5;

	vec2 initialWindowToImageCoordinates(vec2 point){
		float imageRatio = u_imageSize.x/u_imageSize.y;
		float displayRatio = u_screenResolution.x/u_screenResolution.y;
		float ratio = displayRatio/imageRatio;
		return (ratio>1.0)? vec2((point.x-0.5)*ratio+0.5,point.y):vec2(point.x,(point.y-0.5)/ratio+0.5);
	}

	vec2 currentWindowToInitialWindowCoordinates(vec2 point){
		return u_centerShift+(point-0.5)/u_zoomFactor;
	}

	// vec4 interpolate(vec4 coord1, vec4 coord2, float weight1, float weight2) {
	// 	vec4 result;
	// 	result.zw = weight1 * coord1.zw + weight2 * coord2.zw;
	// 	if (all(equal(coord1.xy,vec2(-2.0)))) {
	// 		if (all(equal(coord2.xy,vec2(-2.0)))) result.xy = vec2(-2.0);
	// 		else result.xy = (weight1 + weight2) * coord2.xy;
	// 	} else {
	// 		if (all(equal(coord2.xy,vec2(-2.0)))) result.xy = (weight1 + weight2) * coord1.xy;
	// 		else result.xy = weight1 * coord1.xy + weight2 * coord2.xy;
	// 	}
	// 	return result;
	// }

	// vec4 interpolate(vec4 coord1, vec4 coord2, float weight) {
	// 	vec4 result;
	// 	result.zw = weight * coord1.zw + (1.0-weight) * coord2.zw;
	// 	if (all(equal(coord1.xy,vec2(-2.0)))) {
	// 		if (all(equal(coord2.xy,vec2(-2.0)))) result.xy = vec2(-2.0);
	// 		else result.xy = coord2.xy;
	// 	} else {
	// 		if (all(equal(coord2.xy,vec2(-2.0)))) result.xy = coord1.xy;
	// 		else result.xy = weight * coord1.xy + (1.0-weight) * coord2.xy;
	// 	}
	// 	return result;
	// }

	vec4 interpolate_zw(vec4 coord1, vec4 coord2, float weight) {
		vec4 result;
		result.zw = weight * coord1.zw + (1.0-weight) * coord2.zw;
		result.xy = coord1.xy;
		return result;
	}

	// vec4 cubic_interpolation(float X, vec4 x) {
	// 	vec4 res = vec4(1.0);
	// 	for (int i=0; i<4; i++) {
	// 		for (int j=0; j<4; j++) {
	// 			if (i!=j) res[i] *= (X-x[j])/(x[i]-x[j]);
	// 		}
	// 	}
	// 	return res;
	// }

	// vec3 quadratic_interpolation(float X, vec3 x) {
	// 	vec3 res = vec3(1.0);
	// 	for (int i=0; i<3; i++) {
	// 		for (int j=0; j<3; j++) {
	// 			if (i!=j) res[i] *= (X-x[j])/(x[i]-x[j]);
	// 		}
	// 	}
	// 	return res;
	// }

	vec4 shift_coord(vec4 coord, vec2 shift) {
		if (all(equal(coord.xy,vec2(-2.0)))) return coord + vec4(vec2(0.0), shift);
		return coord + vec4(shift, shift);
	}

	// vec4 getCollisionPoints(float rayAngle){
	// 	//Get the boundary point based on the fragment position and the angle of the ray
	// 	float rayIndex = degrees(rayAngle+(5.0*PI/12.0))/10.0; //0.0-15.0
	// 	vec2 blockCoord = mod(gl_FragCoord.xy/u_devicePixelRatio,4.0); //coordinate inside of the 4x4 block
	// 	vec2 blockOrigin = gl_FragCoord.xy/u_devicePixelRatio-blockCoord; //origin of the 4x4 block in screen coord

	// 	// float index2 = floor(rayIndex);
	// 	float index2 = fract(rayIndex)<0.5? floor(rayIndex): ceil(rayIndex);
	// 	float index3 = index2 + 1.0;
	// 	float index1 = index2 - 1.0;
	// 	vec2 point1 = (blockOrigin + vec2(0.5) + vec2(mod(index1, 4.0), (index1-mod(index1, 4.0))/4.0))/u_screenResolution;
	// 	vec2 point2 = (blockOrigin + vec2(0.5) + vec2(mod(index2, 4.0), (index2-mod(index2, 4.0))/4.0))/u_screenResolution;
	// 	vec2 point3 = (blockOrigin + vec2(0.5) + vec2(mod(index3, 4.0), (index3-mod(index3, 4.0))/4.0))/u_screenResolution;
	// 	// vec2 point4 = (blockOrigin + vec2(0.5) + vec2(mod(index4, 4.0), (index4-mod(index4, 4.0))/4.0))/u_screenResolution;

	// 	vec2 local_shift = vec2((blockCoord.x - 1.5)* 2.0 / u_screenResolution.x, 0.0);
	// 	vec4 coord1 = shift_coord(texture2D(u_collisionCoordTexture, point1), local_shift);
	// 	vec4 coord2 = shift_coord(texture2D(u_collisionCoordTexture, point2), local_shift);
	// 	vec4 coord3 = shift_coord(texture2D(u_collisionCoordTexture, point3), local_shift);
	// 	// vec4 coord4 = shift_coord(texture2D(u_collisionCoordTexture, point4), local_shift);

	// 	vec3 coeffs = quadratic_interpolation(rayIndex, vec3(index1, index2, index3));
	// 	// vec4 coeffs = cubic_interpolation(rayIndex, vec4(index1, index2, index3, index4));
	// 	// vec4 coord = interpolate(interpolate(coord1, coord2, coeffs[0], coeffs[1]),interpolate(coord3, coord4, coeffs[2], coeffs[3]), 1.0, 1.0);

	// 	vec4 coord = interpolate(interpolate(coord1, coord2, coeffs[0], coeffs[1]/2.0), interpolate(coord2, coord3, coeffs[1]/2.0, coeffs[2]),  1.0, 1.0);
	// 	return coord;

	// }

	vec4 getCollisionPoints(float rayAngle){
		//Get the boundary point based on the fragment position and the angle of the ray
		float rayIndex = degrees(rayAngle+(5.0*PI/12.0))/10.0; //0.0-15.0
		vec2 blockCoord = mod(gl_FragCoord.xy/u_devicePixelRatio,4.0); //coordinate inside of the 4x4 block
		vec2 blockOrigin = gl_FragCoord.xy/u_devicePixelRatio-blockCoord; //origin of the 4x4 block in screen coord

		float floorIndex = floor(rayIndex);
		float ceilIndex = ceil(rayIndex);
		vec2 point1 = blockOrigin + vec2(0.5) + vec2(mod(floorIndex, 4.0), (floorIndex-mod(floorIndex, 4.0))/4.0);
		vec2 point2 = blockOrigin + vec2(0.5) + vec2(mod(ceilIndex, 4.0), (ceilIndex-mod(ceilIndex, 4.0))/4.0);
		point1 /= u_screenResolution;
		point2 /= u_screenResolution;

		vec2 local_shift = vec2((blockCoord.x - 1.5)* 2.0 / u_screenResolution.x, 0.0);
		vec4 coord1 = shift_coord(texture2D(u_collisionCoordTexture, point1), local_shift);
		vec4 coord2 = shift_coord(texture2D(u_collisionCoordTexture, point2), local_shift);
		vec4 coord = fract(rayIndex)>0.5? interpolate_zw(coord2, coord1, fract(rayIndex)) : interpolate_zw(coord1, coord2, 1.0-fract(rayIndex));

		return coord;
	}

	vec4 getReflectionCoords(vec3 normal, vec3 view){
		float incidenceAngle = dot(normal, view);
		vec3 reflectionVector = normalize(2.0*incidenceAngle*normal - view);
		vec2 fragCoord = (gl_FragCoord.xy/(u_devicePixelRatio*u_screenResolution))*2.0-1.0;

		vec4 temp = u_vpMatrix * vec4(vPos+reflectionVector,1.0);
		vec2 reflectionVectorDisplay = (temp.xy / temp.w) - fragCoord.xy;
		float rayAngle = atan(reflectionVectorDisplay.x/reflectionVectorDisplay.y); //[-75,75] -> ok
		reflectionVectorDisplay /= abs(reflectionVectorDisplay.y);

		rayAngle = clamp(rayAngle, -5.0*PI/12.0, 5.0*PI/12.0);
		return getCollisionPoints(rayAngle);
	}

	void main (void) {
		vec2 fragPosCurrentWindowCoord = gl_FragCoord.xy/(u_devicePixelRatio*u_screenResolution);
		vec2 fragPosInitialWindowCoord = currentWindowToInitialWindowCoordinates(fragPosCurrentWindowCoord);
		vec2 fragPosImageCoord = initialWindowToImageCoordinates(fragPosInitialWindowCoord);
		if(any(greaterThan(abs(fragPosImageCoord-0.5),vec2(0.5)))) discard;

		float opacity = texture2D(u_maskTexture, fragPosImageCoord).r;
		if(opacity <= 0.0) discard;

		vec3 normal = normalize(texture2D(u_normalMap, vUV).xyz);
		vec3 view = normalize(u_cameraPosition - vPos);

		vec4 reflectionCoords = getReflectionCoords(normal,view);
		gl_FragColor = reflectionCoords;
	}
	`
};

THREE.ShaderLib["ocean_boundaryRayCollision"] = {
	uniforms: {
		"u_screenResolution": { value: null },
		"u_maskTexture": { value: null },
		"u_centerShift": { value: null },
		"u_zoomFactor": { value: null },
		"u_imageSize": { value: null },
	},
	fragmentShader: `
	precision highp float;
	uniform vec2 u_screenResolution;
	uniform sampler2D u_maskTexture;
	uniform vec2 u_centerShift;
	uniform float u_zoomFactor;
	uniform vec2 u_imageSize;

	// uniform mat4 u_vpMatrix;
	// uniform mat4 u_vpMatrixInverse;
	// uniform vec3 u_cameraPosition;

	#ifdef COARSE_ITERATION
		const int iterationNo = 50;
		const int MAX_BOUNDARIES = 1;
	#else
		const int iterationNo = 1080;
		const int MAX_BOUNDARIES = 5;
	#endif

	const float MASK_THRESHOLD = 0.5;
	const float PI = 3.1415926535897932384626433832795;

	struct WindowBlock{
		vec2  origin;
		float localId;
	};

	WindowBlock getWindowBlock(){
		vec2 blockLocalCoord = mod(gl_FragCoord.xy,4.0); //coordinate inside of the 4x4 block
		vec2 blockOrigin = (gl_FragCoord.xy-blockLocalCoord+vec2(2.0,2.0))/u_screenResolution; //center of the 4x4 block. vec2(2,2) is just to get the center (because the block is 4x4)
		float blockId = floor(blockLocalCoord.x)+floor(blockLocalCoord.y)*4.0; //assigns 0-15 to each pixel
		return WindowBlock(blockOrigin, blockId);
	}

	bool textureCoordOutOfRange(vec2 coord){
		return any(greaterThan(abs(coord-0.5),vec2(0.5)));
	}

	vec2 currentWindowToInitialWindowCoordinates(vec2 point){
		return u_centerShift+(point-0.5)/u_zoomFactor;
	}

	vec2 initialWindowToImageCoordinates(vec2 point){
		float imageRatio = u_imageSize.x/u_imageSize.y;
		float displayRatio = u_screenResolution.x/u_screenResolution.y;
		float ratio = displayRatio/imageRatio;
		return (ratio>1.0)? vec2((point.x-0.5)*ratio+0.5,point.y):vec2(point.x,(point.y-0.5)/ratio+0.5);
	}

	vec2 windowToImageCoordinatesVector(vec2 vec){
		float imageRatio = u_imageSize.x/u_imageSize.y;
		float displayRatio = u_screenResolution.x/u_screenResolution.y;
		return vec2(vec.x*imageRatio/displayRatio,vec.y);
	}

	vec2 imageToCurrentWindowCoordinates(vec2 point){
		float imageRatio = u_imageSize.x/u_imageSize.y;
		float displayRatio = u_screenResolution.x/u_screenResolution.y;
		float ratio = displayRatio/imageRatio;
		point = (ratio > 1.0)? vec2((point.x-0.5)/ratio+0.5,point.y):vec2(point.x,(point.y-0.5)*ratio+0.5);
		return (point-u_centerShift)*u_zoomFactor+vec2(0.5);
	}

	float getMaskVal(vec2 coord){
		if(textureCoordOutOfRange(coord)) return 0.0;
		else return texture2D(u_maskTexture, coord).r;
	}

	// vec3 getRayPlaneIntersectionPoint(vec2 position){
	// 	vec4 worldRayEnd1 = u_vpMatrixInverse * vec4( position.xy, -1.0, 1.0);
	// 	vec4 worldRayEnd2 = u_vpMatrixInverse * vec4( position.xy, 1.0, 1.0);
	// 	worldRayEnd1.xyz = worldRayEnd1.xyz/worldRayEnd1.w;
	// 	worldRayEnd2.xyz = worldRayEnd2.xyz/worldRayEnd2.w;
	// 	vec3 geometryPos = (worldRayEnd1.xyz*worldRayEnd2.y - worldRayEnd2.xyz*worldRayEnd1.y)/(worldRayEnd2.y-worldRayEnd1.y);
	// 	return geometryPos;
	// }

 	vec4 getBoundaryPoints(vec2 rayPoint, vec2 rayVector){
		vec2 vPos2D = rayPoint*2.0-1.0;
		rayPoint = currentWindowToInitialWindowCoordinates(rayPoint);
		rayPoint = initialWindowToImageCoordinates(rayPoint);
		rayVector = windowToImageCoordinatesVector(rayVector);
		rayVector = rayVector*(1.0-rayPoint.y)*1.1/float(iterationNo);

		int boundaries_found = 0;
		bool inside_object = false;
		int outside_object_count = 0;
		vec2 boundary_points[MAX_BOUNDARIES];
		for(int i=0; i< iterationNo; i++){
			rayPoint = rayPoint + rayVector;
			float mask_val = getMaskVal(rayPoint);
			if(mask_val < MASK_THRESHOLD) {
				outside_object_count = 0;
				if(inside_object) continue;
				inside_object=true;
				boundary_points[boundaries_found++] = rayPoint;
				if(boundaries_found==MAX_BOUNDARIES) break;
			}else {
				outside_object_count ++;
				if (inside_object && outside_object_count > 10) {
					inside_object=false;
				}
			}
		}

		vec2 boundaryPoint2D1 = boundaries_found<=1? vec2(-2.0):imageToCurrentWindowCoordinates(boundary_points[0])*2.0-1.0;
		vec2 boundaryPoint2D2 = imageToCurrentWindowCoordinates(boundary_points[boundaries_found-1])*2.0-1.0;
		return vec4(boundaryPoint2D1, boundaryPoint2D2);
	}

	void main (void) {
		WindowBlock block = getWindowBlock();
		vec2 rayVector = vec2(tan((PI/18.0)*block.localId-(5.0*PI/12.0)),1.0); //ranges 150 degrees (+-75 degrees from y axis)
		vec2 rayPoint = block.origin;
		
		gl_FragColor =  getBoundaryPoints(rayPoint, rayVector);
	}
	`
};

THREE.ShaderLib["full_screen_texture"] = {
	uniforms: {
		"u_screenResolution": { value: null },
		"u_textures": { type: 'tv', value: null },
		"u_texture_interpolation": { value: null },
		"u_centerShift": { value: null },
		"u_zoomFactor": { value: null },
		"u_imageSize": { value: null },
		"u_devicePixelRatio": { value: null },
		"u_disabled": { value: false }
	},
	vertexShader: `
	void main (void) {
		gl_Position = vec4(position, 1.0 );
	}
	`,
	fragmentShader: `
	precision highp float;

	const int MAX_TEXTURE_NUM=8;
	uniform sampler2D u_textures[MAX_TEXTURE_NUM];
	uniform float u_texture_interpolation;

	uniform vec2 u_screenResolution;
	uniform vec2 u_imageSize;

	uniform vec2 u_centerShift;
	uniform float u_zoomFactor;
	uniform float u_devicePixelRatio;

	uniform bool u_disabled;

	vec4 texture2D_interpolate(sampler2D textures[MAX_TEXTURE_NUM], vec2 coord) {
		vec4 values[MAX_TEXTURE_NUM];
		values[0] = texture2D(textures[0], coord);
		values[1] = texture2D(textures[1], coord);
		values[2] = texture2D(textures[2], coord);
		values[3] = texture2D(textures[3], coord);
		values[4] = texture2D(textures[4], coord);
		values[5] = texture2D(textures[5], coord);
		values[6] = texture2D(textures[6], coord);
		values[7] = texture2D(textures[7], coord);

		vec4 val1 = values[int(floor(u_texture_interpolation))];
		vec4 val2 = values[int(ceil(u_texture_interpolation))];
		return (ceil(u_texture_interpolation)-u_texture_interpolation) * val1 + (1.0-(ceil(u_texture_interpolation)-u_texture_interpolation)) * val2;
	}

	vec2 initialWindowToImageCoordinates(vec2 point){
		float imageRatio = u_imageSize.x/u_imageSize.y;
		float displayRatio = u_screenResolution.x/u_screenResolution.y;
		float ratio = displayRatio/imageRatio;
		return (ratio>1.0)? vec2((point.x-0.5)*ratio+0.5,point.y):vec2(point.x,(point.y-0.5)/ratio+0.5);
	}

	vec2 currentWindowToInitialWindowCoordinates(vec2 point){
		return u_centerShift+(point-0.5)/u_zoomFactor;
	}

	void main (void) {
		if (u_disabled) {gl_FragColor = vec4(0.0); return;}
		vec2 fragPosCurrentWindowCoord = gl_FragCoord.xy/(u_devicePixelRatio*u_screenResolution);
		vec2 fragPosInitialWindowCoord = currentWindowToInitialWindowCoordinates(fragPosCurrentWindowCoord);
		vec2 coord = initialWindowToImageCoordinates(fragPosInitialWindowCoord);
		if(any(greaterThanEqual(abs(coord-0.5),vec2(0.5)))) discard;
		vec3 color = texture2D_interpolate(u_textures, coord).rgb;
		gl_FragColor = vec4(color, 1.0);
	}
	`
};