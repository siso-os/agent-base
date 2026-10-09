import type { SVGProps } from "react";
type IconProps = SVGProps<SVGSVGElement> & { size?: number };
function Icon({ size = 16, children, ...props }: IconProps) { return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>{children}</svg>; }
export const CheckIcon = (props: IconProps) => <Icon {...props}><path d="m20 6-11 11-5-5"/></Icon>;
export const ChevronUpIcon = (props: IconProps) => <Icon {...props}><path d="m18 15-6-6-6 6"/></Icon>;
export const CloseIcon = (props: IconProps) => <Icon {...props}><path d="M18 6 6 18M6 6l12 12"/></Icon>;
export const StopIcon = (props: IconProps) => <Icon {...props}><rect width="18" height="18" x="3" y="3" rx="2"/></Icon>;
export const LayersIcon = (props: IconProps) => <Icon {...props}><path d="m12.83 2.18 8.34 4.55a1 1 0 0 1 0 1.76l-8.34 4.55a2 2 0 0 1-1.66 0L2.83 8.49a1 1 0 0 1 0-1.76l8.34-4.55a2 2 0 0 1 1.66 0"/><path d="m2 12 9.17 5a2 2 0 0 0 1.66 0L22 12M2 17l9.17 5a2 2 0 0 0 1.66 0L22 17"/></Icon>;
