import Event from '../../src/models/event.js';
import { EventType, EventSource } from '../../src/types/index.js';

describe('Event Model Test', () => {
  it('should create & save event successfully', async () => {
    const validEvent = {
      title: 'Test Concert',
      description: 'A test concert',
      source: 'eventbrite' as EventSource,
      source_url: 'https://test.com',
      type: 'concert' as EventType,
      price: {
        min: 10,
        max: 50
      },
      location: {
        type: 'Point',
        coordinates: [-73.935242, 40.730610],
        address: '123 Test St'
      },
      datetime: {
        start: new Date(),
        end: new Date(Date.now() + 3600000)
      },
      is_active: true
    };

    const savedEvent = await Event.create(validEvent);
    expect(savedEvent.id).toBeDefined();
    expect(savedEvent.title).toBe(validEvent.title);
  });

  it('should fail to save event without required fields', async () => {
    const incompleteEvent = {
      source: 'eventbrite' as EventSource,
      type: 'concert' as EventType,
      location: {
        type: 'Point',
        coordinates: [-73.935242, 40.730610]
      },
      datetime: {
        start: new Date(),
        end: new Date(Date.now() + 3600000)
      },
      is_active: true
    } as any;

    await expect(Event.create(incompleteEvent)).rejects.toThrow();
  });
}); 