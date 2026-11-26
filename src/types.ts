export type Suivi<T> = (x: T) => void | Promise<void>;

export type Oublier = () => Promise<void>;
