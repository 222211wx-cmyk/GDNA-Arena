export default function ApexBanner() {
  return (
    <section className="relative w-full h-screen bg-black flex items-center justify-center overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-black via-gray-900 to-black"></div>
      <div className="absolute w-[800px] h-[800px] bg-yellow-500/10 rounded-full blur-3xl"></div>

      <div className="relative z-10 text-center px-4">
        <h2 className="text-yellow-400 text-2xl tracking-[0.5em] mb-6">GDNA ARENA</h2>
        <h1 className="text-6xl md:text-8xl font-black text-white mb-4">
          El Qaisy
          <span className="block text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-yellow-600">
            Abdelmalik
          </span>
        </h1>
        <p className="text-yellow-400 text-xl font-semibold">FOUNDER OF THE EMPIRE • TOP HONORED CITIZEN</p>
        <button className="mt-8 bg-yellow-500 text-black px-8 py-3 rounded-full font-bold text-lg hover:scale-105 transition">
          JOIN THE EMPIRE
        </button>
      </div>
    </section>
  );
}
