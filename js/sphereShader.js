THREE.ShaderLib[ "sphere_shader" ] = {
    uniforms: {
		"u_shConstants": { value: null },
		"u_size": { value:null },
		"u_displacementMap": { value: null },
		"u_sphere_center": { value: null }
    },
    vertexShader: `
        precision highp float;
		varying vec3 v_object_normal;
        varying vec3 v_lighting_normal;
		uniform float u_size;
		uniform vec3 u_sphere_center;
		uniform sampler2D u_displacementMap;

        void main() {
			v_object_normal = normal;
			v_lighting_normal = normalize(vec3(modelMatrix * vec4(normal, 0.0))); 

			vec3 geometryPos =  vec3(modelMatrix * vec4(position, 1.0));
			vec3 newPos = geometryPos + texture2D(u_displacementMap, u_sphere_center.xz/u_size).rgb;
			gl_Position =  projectionMatrix * viewMatrix * vec4(newPos, 1.0);
        }
	`,
    fragmentShader: `
	  varying vec3 v_object_normal;
	  varying vec3 v_lighting_normal;
      uniform vec3 u_shConstants[9];

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

      void main() {
		vec3 sh_color = sh(vec3(v_lighting_normal.x, max(v_lighting_normal.y, 0.0), v_lighting_normal.z));
		vec3 object_color = getBeachBallColor(vec3(v_object_normal.x,v_object_normal.y,v_object_normal.z));
        gl_FragColor = vec4((sh_color*0.5+vec3(0.5))*object_color, 1.0);
      }
    `
};