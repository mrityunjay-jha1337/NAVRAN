import ThreeScene from "./components/three";

function App() {
    return (
        <main className="relative w-screen h-screen overflow-hidden bg-neutral-950 font-sans select-none">
            {/* 3D WebGL Canvas */}
            <ThreeScene />
        </main>
    );
}

export default App;
