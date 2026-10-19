/**
 * Whether this page is past the password or on a door in front of it.
 *
 * On its own so that a component the gate itself draws (the setup wizard
 * uses the site's name and look) can share code with components that ask
 * this, without the two importing each other. gate.tsx provides it.
 */
import { createContext, useContext } from 'react';

/** 'open' past the password; 'door' on one page in front of it. */
export type GateMode = 'open' | 'door';
export const GateContext = createContext<GateMode>('open');
export const useGateMode = () => useContext(GateContext);
