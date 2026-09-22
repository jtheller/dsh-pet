// Delegate all pet configuration reads/saves to the upstream settings route.
export function createVisibilityController({ route, remember, recall }) {
  return async function setVisibility(id, visible) {
    const loaded = await route('/dsh-pet-7340/config', 'GET');
    if (loaded.status !== 200 || loaded.kind !== 'json') throw new Error('Cannot read upstream pet configuration');
    const pets = structuredClone(loaded.obj.main?.pets ?? []);
    const pet = pets.find(p => p.id === id);
    if (!pet) throw new Error('Pet no longer exists');
    if (visible === (pet.display !== 'none')) return;
    if (visible) {
      const saved = await recall();
      pet.display = ['web', 'desktop', 'both'].includes(saved) ? saved : 'desktop';
    } else {
      await remember(pet.display);
      pet.display = 'none';
    }
    const saved = await route('/dsh-pet-7340/config', 'PUT', JSON.stringify({ pets }));
    if (saved.kind !== 'json' || saved.status !== 200 || saved.obj.main?.pets?.find(p => p.id === id)?.display !== pet.display) {
      throw new Error('Upstream settings did not apply pet visibility');
    }
  };
}
