export type VersionLineData = {
 source: {ref:string;sha:string}; preview:{ref:string;sha:string}; live:{ref:string;sha:string}; layers:{node:string;web:string};
};
export const versionSha = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{7,40}$/.test(value) ? value : null;
export function versionLineState(line?: VersionLineData | null) {
 const source=versionSha(line?.source?.sha), live=versionSha(line?.live?.sha);
 return !source || !live ? 'Version unknown' : source === live ? 'Source matches live' : 'Source differs from live';
}
