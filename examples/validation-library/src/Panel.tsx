import Button2 from './Button2';
import { Button10 } from './Button10';
import type { PublicOptions } from './types';

export const Panel = (options: PublicOptions) => (
    <section title={options.title}><Button2 /><Button10 /></section>
);
