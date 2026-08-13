/**
 * Java runtime detection and management.
 *
 * StarMade version requirements:
 *   - Versions >= 0.3     require Java 21  (with --add-opens arg)
 *   - Versions <  0.3     require Java 8   (no extra args)
 *
 * Note two version schemes are in play — the legacy decimal one ("0.203.175",
 * "0.400.307") and the current counter-style one introduced 2026-08 ("0.4.1").
 * See getRequiredJavaVersion.
 *
 * Phase 4 TODO:
 *   - Auto-download Adoptium/Temurin Java 8 and Java 21 to launcher directory
 *   - Store in `jre8/` and `jre21/` subdirectories
 *   - Detect system-installed Java versions as fallback
 *   - Expose IPC: java:detect, java:list, java:download
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** JVM arguments required for Java 21 when launching StarMade >= 0.3.x */
export const JAVA_21_ARGS = [
	'-javaagent:StarMade.jar',
	'--add-opens=java.base/jdk.internal.misc=ALL-UNNAMED',
	'--add-opens=java.base/jdk.internal.ref=ALL-UNNAMED',
	'--add-opens=java.base/java.nio=ALL-UNNAMED',
	'--add-opens=java.base/java.lang=ALL-UNNAMED',
	'--add-opens=java.base/java.util=ALL-UNNAMED',
	'--add-opens=java.base/java.io=ALL-UNNAMED',
];

/**
 * Additional JVM arguments required on macOS for client (non-server) launches.
 * GLFW/LWJGL3 requires the main thread to be the first thread on macOS.
 */
export const MACOS_CLIENT_ARGS = [
	'-XstartOnFirstThread',
];

/** Java 8 requires no additional JVM arguments. */
export const JAVA_8_ARGS: string[] = [];

// ─── Version detection ────────────────────────────────────────────────────────

/**
 * Determine which Java major version is required for a given StarMade version.
 * @returns 21 for versions >= 0.3.x, otherwise 8.
 */
export function getRequiredJavaVersion(starMadeVersion: string): 8 | 21 {
	// Two schemes appear in the build indexes:
	//   legacy — the version is a decimal fraction: "0.17", "0.19624",
	//            "0.203.175", "0.302.101", "0.400.307" (patch appended as a
	//            third component once the minor was zero-padded to 3 digits).
	//   current — since 2026-08 a conventional major.minor.patch counter whose
	//            minor starts at 4: "0.4.0", "0.4.1" (replaced "0.400.307").
	const parts = starMadeVersion.split('.');
	const major = parseInt(parts[0], 10);
	if (parts.length < 2 || isNaN(major)) {
		// Default to Java 8 for unparseable versions (legacy/archive)
		return 8;
	}

	const minorStr = parts[1].trim();
	if (!/^\d+$/.test(minorStr)) return 8;

	// StarMade 1.x and above require Java 21
	if (major >= 1) return 21;

	// A 3-component version with a 1- or 2-digit minor can only be the current
	// scheme — the legacy scheme always padded its minor to three digits before
	// it grew a patch component. That scheme began at 0.4, long after the Java
	// 21 cut-over, so every such build needs Java 21. (Without this, "0.4.1"
	// reads as the decimal 0.4 < ... and, worse, a future "0.10.0" would read as
	// 0.10 and fall back to Java 8.)
	if (parts.length >= 3 && minorStr.length <= 2) return 21;

	// Legacy scheme: compare as the decimal fraction it is, so
	// 0.19624 < 0.203 < 0.3 <= 0.302 < 0.400. Everything from 0.3 on needs Java 21.
	return parseFloat(`0.${minorStr}`) >= 0.3 ? 21 : 8;
}

/**
 * Get the required JVM arguments for a given Java version.
 */
export function getJvmArgsForJava(javaVersion: 8 | 21): string[] {
	return javaVersion === 21 ? JAVA_21_ARGS : JAVA_8_ARGS;
}

// ─── Java download & detection (Phase 4) ─────────────────────────────────────

import fs from 'fs';
import path from 'path';
import https from 'https';
import { execFile } from 'child_process';
import { promisify } from 'util';
import AdmZip from 'adm-zip';
import tar from 'tar-stream';
import { createGunzip } from 'zlib';

const execFileAsync = promisify(execFile);

/**
 * Build the Adoptium download URL for the specified Java version.
 */
function getAdoptiumUrl(version: 8 | 21): string {
	const platform = process.platform === 'win32' ? 'windows'
		: process.platform === 'darwin' ? 'mac'
			: 'linux';
	// Adoptium has no Java 8 aarch64 build for macOS; use x64 via Rosetta 2.
	const arch = (process.arch === 'arm64' && !(platform === 'mac' && version === 8))
		? 'aarch64' : 'x64';

	return `https://api.adoptium.net/v3/binary/latest/${version}/ga/${platform}/${arch}/jre/hotspot/normal/eclipse`;
}

/**
 * Download a file from a URL to a target path.
 */
function downloadFile(url: string, targetPath: string, onProgress?: (percent: number) => void): Promise<void> {
	return new Promise((resolve, reject) => {
		const file = fs.createWriteStream(targetPath);

		https.get(url, (response) => {
			// Handle redirects (301 Moved Permanently, 302 Found, 303 See Other,
			//                    307 Temporary Redirect, 308 Permanent Redirect)
			const status = response.statusCode ?? 0;
			if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
				const redirectUrl = response.headers.location;
				if (redirectUrl) {
					file.close();
					fs.unlinkSync(targetPath);
					downloadFile(redirectUrl, targetPath, onProgress).then(resolve).catch(reject);
					return;
				}
			}

			if (response.statusCode !== 200) {
				reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
				return;
			}

			const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
			let receivedBytes = 0;

			response.on('data', (chunk) => {
				receivedBytes += chunk.length;
				if (onProgress && totalBytes > 0) {
					onProgress((receivedBytes / totalBytes) * 100);
				}
			});

			response.pipe(file);

			file.on('finish', () => {
				file.close();
				resolve();
			});
		}).on('error', (err) => {
			fs.unlink(targetPath, () => {}); // Clean up on error
			reject(err);
		});
	});
}

/**
 * Extract a .tar.gz archive to a target directory.
 */
async function extractTarGz(archivePath: string, targetDir: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const extract = tar.extract();
		const gunzip = createGunzip();
		extract.on('entry', (header, stream, next) => {
			const filePath = path.join(targetDir, header.name);

			if (header.type === 'directory') {
				fs.mkdirSync(filePath, { recursive: true });
				stream.resume();
				stream.on('end', next);
				stream.on('error', reject);

			} else if (header.type === 'symlink' || header.type === 'link') {
				// JDK archives contain many symlinks; create them instead of writing data.
				fs.mkdirSync(path.dirname(filePath), { recursive: true });
				try {
					if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
					fs.symlinkSync(header.linkname!, filePath);
				} catch (err) {
					// Non-fatal: symlink target may not exist yet in the archive order.
					console.warn(`[Java] Warning: failed to create symlink ${filePath} -> ${header.linkname}:`, err);
				}
				stream.resume();
				stream.on('end', next);
				stream.on('error', reject);

			} else {
				// Regular file — wait for the WriteStream to *finish* before chmod/next
				// so the file is guaranteed to exist on disk.
				fs.mkdirSync(path.dirname(filePath), { recursive: true });
				const writeStream = fs.createWriteStream(filePath);
				stream.pipe(writeStream);

				writeStream.on('finish', () => {
					if (header.mode && process.platform !== 'win32') {
						try {
							fs.chmodSync(filePath, header.mode);
						} catch (err) {
							console.warn(`[Java] Warning: failed to chmod ${filePath}:`, err);
						}
					}
					next();
				});

				writeStream.on('error', reject);
				stream.on('error', reject);
			}
		});

		extract.on('finish', resolve);
		extract.on('error', reject);
		gunzip.on('error', reject);

		fs.createReadStream(archivePath).pipe(gunzip).pipe(extract);
	});
}

/**
 * Download the specified Java runtime (Adoptium/Temurin) to the launcher's jre8/ or jre21/ directory.
 */
export async function downloadJava(
	version: 8 | 21,
	launcherDir: string,
	onProgress?: (percent: number) => void
): Promise<string> {
	const jreDir = path.join(launcherDir, `jre${version}`);
	const tempFile = path.join(launcherDir, `jre${version}.tmp`);

	console.log(`[Java] Downloading Java ${version} from Adoptium...`);

	try {
		// Download the archive
		const url = getAdoptiumUrl(version);
		await downloadFile(url, tempFile, onProgress);

		console.log(`[Java] Download complete. Extracting to ${jreDir}...`);

		// Remove existing JRE directory if it exists
		if (fs.existsSync(jreDir)) {
			fs.rmSync(jreDir, { recursive: true, force: true });
		}

		// Create target directory
		fs.mkdirSync(jreDir, { recursive: true });

		// Extract based on platform
		if (process.platform === 'win32') {
			// Windows: .zip
			const zip = new AdmZip(tempFile);
			zip.extractAllTo(jreDir, true);
		} else {
			// macOS/Linux: .tar.gz
			await extractTarGz(tempFile, jreDir);
		}

		// Find the Java executable in the extracted files
		const javaPath = await findJavaExecutable(jreDir);

		// Clean up temp file
		fs.unlinkSync(tempFile);

		console.log(`[Java] Java ${version} installed successfully at ${javaPath}`);
		return javaPath;

	} catch (error) {
		// Clean up on error
		if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
		if (fs.existsSync(jreDir)) fs.rmSync(jreDir, { recursive: true, force: true });
		throw error;
	}
}

/**
 * Recursively find the java/javaw executable in a directory.
 * Throws if not found.
 */
function findJavaExecutable(dir: string): string {
	const javaExe = process.platform === 'win32' ? 'javaw.exe' : 'java';

	function search(currentDir: string): string | null {
		const entries = fs.readdirSync(currentDir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry.name);

			if (entry.isDirectory()) {
				const result = search(fullPath);
				if (result) return result;
			} else if (entry.name === javaExe) {
				return fullPath;
			}
		}

		return null;
	}

	const result = search(dir);
	if (!result) {
		throw new Error(`Could not find ${javaExe} in extracted JRE`);
	}

	return result;
}

/**
 * Recursively find the java/javaw executable in a JRE directory.
 * Unlike `findJavaExecutable`, returns null instead of throwing when
 * the executable is not found — safe for use in detection logic.
 *
 * Adoptium/Temurin archives are extracted with a versioned subdirectory
 * inside the target folder (e.g. jre8/jdk8u362-b09-jre/bin/java), so a
 * simple path.join(jreDir, 'bin', 'java') will always miss them.
 */
export function findJavaExecutableInDir(dir: string): string | null {
	try {
		return findJavaExecutable(dir);
	} catch {
		return null;
	}
}

/**
 * Parse Java version from `java -version` output.
 * Returns the major version number (e.g. 8, 11, 17, 21).
 */
export function parseJavaVersion(versionOutput: string): number | null {
	// Example outputs:
	// openjdk version "1.8.0_362"
	// openjdk version "11.0.18"
	// java version "17.0.6"
	// openjdk version "21.0.0"

	const match = versionOutput.match(/version "([^"]+)"/);
	if (!match) return null;

	const versionStr = match[1];
	const parts = versionStr.split('.');

	// Handle 1.8.x format (Java 8)
	if (parts[0] === '1' && parts[1]) {
		return parseInt(parts[1], 10);
	}

	// Handle 11.x, 17.x, 21.x format
	return parseInt(parts[0], 10);
}

/**
 * Parse the JVM bitness (architecture data model) from `java -version` output.
 *
 * The third line of `java -version` describes the VM, e.g.:
 *   64-bit: "OpenJDK 64-Bit Server VM (build 21.0.0+35)"
 *           "Java HotSpot(TM) 64-Bit Server VM ..."
 *   32-bit: "OpenJDK Server VM (build ...)"
 *           "Java HotSpot(TM) Client VM ..."
 *
 * A 32-bit JVM cannot address a heap >= ~4 GB, so `-Xms4096M`/`-Xmx4096M` (or
 * larger) fail with "Invalid initial heap size … exceeds the maximum
 * representable size". We use this to avoid selecting a 32-bit runtime.
 *
 * @returns 64 or 32, or null when the VM line is absent/unrecognized.
 */
export function parseJavaBitness(versionOutput: string): 64 | 32 | null {
	if (!versionOutput) return null;
	// Only classify when we actually saw a VM description line.
	if (!/\bVM\b/i.test(versionOutput)) return null;
	return /64-bit/i.test(versionOutput) ? 64 : 32;
}

/**
 * Pick the executable to run for a `-version` probe.
 *
 * On Windows the launch binary is `javaw.exe` (no console window), but `javaw.exe`
 * does not reliably write `-version` output to a piped stderr — so probing it makes
 * a perfectly good runtime look absent, which in turn triggers a redundant Java
 * download. When the path is a `javaw.exe`, probe the sibling console binary
 * `java.exe` instead (falling back to the given path if `java.exe` is missing). The
 * launch path the caller stores is unchanged — only the probe target differs.
 */
export function versionProbePath(javaPath: string): string {
	if (process.platform !== 'win32') return javaPath;
	if (path.basename(javaPath).toLowerCase() !== 'javaw.exe') return javaPath;
	const consolePath = path.join(path.dirname(javaPath), 'java.exe');
	return fs.existsSync(consolePath) ? consolePath : javaPath;
}

/**
 * Check if a Java executable is valid and return its version and bitness.
 * `arch` is 64 or 32 when it can be determined, otherwise null.
 */
export async function checkJavaExecutable(
	javaPath: string,
): Promise<{ version: number; path: string; arch: 64 | 32 | null } | null> {
	try {
		const { stderr } = await execFileAsync(versionProbePath(javaPath), ['-version']);
		const version = parseJavaVersion(stderr);

		if (version) {
			return { version, path: javaPath, arch: parseJavaBitness(stderr) };
		}
	} catch (error) {
		// Executable doesn't exist or failed to run
	}

	return null;
}

/**
 * Build the list of directories to scan for system-installed Java runtimes.
 *
 * Each entry is treated as a *vendor parent* that holds one versioned JDK/JRE
 * subdirectory per install (e.g. `…\Amazon Corretto\jdk21…`), and is also probed
 * directly in case it is itself a JDK root (e.g. `JAVA_HOME`).
 *
 * Pure and platform-parameterized so it can be unit-tested. Windows roots are
 * derived from environment variables rather than a hardcoded `C:` so non-default
 * drive letters and per-user installs are covered.
 */
export function getSystemJavaSearchPaths(
	env: NodeJS.ProcessEnv,
	platform: NodeJS.Platform,
): string[] {
	const paths: string[] = [];
	const add = (p: string | undefined) => { if (p) paths.push(p); };

	if (platform === 'win32') {
		const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
		const programFilesX86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
		const localAppData = env.LOCALAPPDATA;

		// Common vendor parent directories. Each holds versioned JDK/JRE subfolders.
		const vendorDirs = [
			'Java',                 // Oracle
			'Eclipse Adoptium',     // Temurin (current)
			'Eclipse Foundation',   // Temurin (older)
			'Temurin',
			'Amazon Corretto',
			'Zulu',                 // Azul
			'Microsoft',            // Microsoft Build of OpenJDK (Microsoft\jdk-*)
			'Semeru',               // IBM Semeru
			'IBM',
			'BellSoft\\LibericaJDK',
			'AdoptOpenJDK',         // legacy AdoptOpenJDK
			'RedHat',               // Red Hat build of OpenJDK
		];
		for (const base of [programFiles, programFilesX86]) {
			for (const vendor of vendorDirs) add(path.join(base, vendor));
		}

		// Per-user installs (winget / "install for me only").
		if (localAppData) {
			add(path.join(localAppData, 'Programs', 'Eclipse Adoptium'));
			add(path.join(localAppData, 'Programs', 'Microsoft'));
			add(path.join(localAppData, 'Programs', 'Java'));
			add(path.join(localAppData, 'Eclipse Adoptium'));
		}
	} else if (platform === 'darwin') {
		add('/Library/Java/JavaVirtualMachines');
		add('/System/Library/Java/JavaVirtualMachines');
	} else {
		add('/usr/lib/jvm');
		add('/usr/java');
		add('/opt/java');
		add('/usr/lib64/jvm');
	}

	// JAVA_HOME points directly at a JDK root; it is probed both directly and as a
	// parent (harmless when it has no version subdirs).
	add(env.JAVA_HOME);

	// De-duplicate while preserving order.
	return [...new Set(paths.map(p => path.normalize(p)))];
}

/**
 * Detect system-installed Java runtimes by scanning common install paths.
 */
export async function detectSystemJava(): Promise<Array<{ version: string; path: string; arch: 64 | 32 | null }>> {
	const results: Array<{ version: string; path: string; arch: 64 | 32 | null }> = [];
	const javaExe = process.platform === 'win32' ? 'javaw.exe' : 'java';

	const searchPaths = getSystemJavaSearchPaths(process.env, process.platform);

	// Resolve the bin/<javaExe> path for a given JDK/JRE root directory.
	const binPathFor = (root: string): string =>
		process.platform === 'darwin'
			? path.join(root, 'Contents', 'Home', 'bin', javaExe)
			: path.join(root, 'bin', javaExe);

	const considerRoot = async (root: string): Promise<void> => {
		const result = await checkJavaExecutable(binPathFor(root));
		if (!result) return;
		// StarMade needs a 64-bit JVM (large heaps). A 32-bit Java rejects
		// -Xms/-Xmx >= ~4 GB, so don't offer it.
		if (result.arch === 32) {
			console.log(`[Java] Ignoring 32-bit Java at ${result.path}`);
			return;
		}
		if (!results.some(r => r.path === result.path)) {
			results.push({ version: String(result.version), path: result.path, arch: result.arch });
		}
	};

	// Scan each path: probe it directly (it may itself be a JDK root, e.g. JAVA_HOME)
	// and probe each immediate subdirectory (vendor-parent layout).
	for (const searchPath of searchPaths) {
		if (!fs.existsSync(searchPath)) continue;

		await considerRoot(searchPath);

		try {
			const entries = fs.readdirSync(searchPath, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				await considerRoot(path.join(searchPath, entry.name));
			}
		} catch (error) {
			// Skip directories we can't read
			continue;
		}
	}

	// Also check java in PATH
	try {
		const { stderr } = await execFileAsync('java', ['-version']);
		const version = parseJavaVersion(stderr);
		const arch = parseJavaBitness(stderr);
		if (version && arch !== 32) {
			const { stdout } = await execFileAsync(process.platform === 'win32' ? 'where' : 'which', ['java']);
			const javaPath = stdout.trim().split('\n')[0];

			// Only add if not already in results
			if (!results.some(r => r.path === javaPath)) {
				results.push({ version: String(version), path: javaPath, arch });
			}
		}
	} catch (error) {
		// Java not in PATH
	}

	return results;
}

/**
 * Resolve the Java executable path for the given required version.
 * Priority order:
 *   1. Launcher-bundled JRE (jre8/ or jre21/)
 *   2. System-installed Java matching the required version
 *   3. Returns null if not found (caller should trigger download)
 */
export async function resolveJavaPath(requiredVersion: 8 | 21, launcherDir: string): Promise<string | null> {
	// 1. Check bundled JRE.
	// Adoptium/Temurin archives extract into a versioned subdirectory inside
	// jreDir (e.g. jre8/jdk8u362-b09-jre/bin/java), so we must search
	// recursively rather than assuming jreDir/bin/java exists directly.
	const jreDir = path.join(launcherDir, `jre${requiredVersion}`);

	if (fs.existsSync(jreDir)) {
		const bundledJavaPath = findJavaExecutableInDir(jreDir);
		if (bundledJavaPath) {
			const result = await checkJavaExecutable(bundledJavaPath);
			if (result && result.version === requiredVersion && result.arch !== 32) {
				console.log(`[Java] Using bundled Java ${requiredVersion}: ${bundledJavaPath}`);
				return bundledJavaPath;
			}
			if (result && result.arch === 32) {
				console.warn(`[Java] Bundled Java at ${bundledJavaPath} is 32-bit — ignoring (cannot allocate large heaps)`);
			}
		}
	}

	// 2. Check system Java
	const systemJavas = await detectSystemJava();
	const matchingJava = systemJavas.find(j => parseInt(j.version, 10) === requiredVersion);

	if (matchingJava) {
		console.log(`[Java] Using system Java ${requiredVersion}: ${matchingJava.path}`);
		return matchingJava.path;
	}

	// 3. Not found
	console.log(`[Java] Java ${requiredVersion} not found`);
	return null;
}

/**
 * Resolve a usable Java for `version`, downloading it only if none is available.
 *
 * Resolution order:
 *   1. `preferredPath` (e.g. an installation's stored customJavaPath) when it
 *      exists on disk, is the required major version, and is 64-bit →
 *      `usedPreferred: true`.
 *   2. A bundled or system runtime via `resolveJavaPath()` → `usedPreferred: false`.
 *   3. Download from Adoptium → `downloaded: true`.
 *
 * This mirrors `launchGame()`'s custom-path-then-auto-resolve logic in a single
 * shared place, so the pre-launch "do we need to download?" decision and the launch
 * itself never disagree (which is what caused redundant downloads).
 */
export async function ensureJava(
	version: 8 | 21,
	launcherDir: string,
	opts: { preferredPath?: string } = {},
	// Dependencies are injectable for testing; production callers use the defaults.
	deps: {
		exists?: (p: string) => boolean;
		check?: typeof checkJavaExecutable;
		resolve?: typeof resolveJavaPath;
		download?: typeof downloadJava;
	} = {},
): Promise<{ path: string; downloaded: boolean; usedPreferred: boolean }> {
	const exists = deps.exists ?? fs.existsSync;
	const check = deps.check ?? checkJavaExecutable;
	const resolve = deps.resolve ?? resolveJavaPath;
	const download = deps.download ?? downloadJava;

	const preferred = opts.preferredPath?.trim();
	if (preferred && exists(preferred)) {
		const detected = await check(preferred);
		// arch !== 32 accepts 64-bit and unknown; only a confirmed 32-bit JVM is rejected.
		if (detected && detected.version === version && detected.arch !== 32) {
			return { path: preferred, downloaded: false, usedPreferred: true };
		}
	}

	const resolved = await resolve(version, launcherDir);
	if (resolved) {
		return { path: resolved, downloaded: false, usedPreferred: false };
	}

	const downloaded = await download(version, launcherDir);
	return { path: downloaded, downloaded: true, usedPreferred: false };
}

/**
 * Get the default Java executable paths for jre8 and jre21 from the launcher directory.
 * These paths may not exist yet if the JREs haven't been downloaded.
 * @returns Object with jre8Path and jre21Path strings.
 */
export function getDefaultJavaPaths(launcherDir: string): { jre8Path: string; jre21Path: string } {
	const jre8Path = process.platform === 'win32'
		? path.join(launcherDir, 'jre8', 'bin', 'javaw.exe')
		: path.join(launcherDir, 'jre8', 'bin', 'java');

	const jre21Path = process.platform === 'win32'
		? path.join(launcherDir, 'jre21', 'bin', 'javaw.exe')
		: path.join(launcherDir, 'jre21', 'bin', 'java');

	return { jre8Path, jre21Path };
}

