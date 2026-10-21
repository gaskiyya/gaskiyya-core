import { useState } from 'react';

export function App() {
  const [count, setCount] = useState(0);

  return (
    <main>
      <h1>Gaskiyya</h1>
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        count is {count}
      </button>
      <p>
        Edit <code>src/App.tsx</code> and save to reload.
      </p>
    </main>
  );
}
