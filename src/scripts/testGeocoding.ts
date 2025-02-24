import geocodingService from '../services/geocodingService.js';
import dotenv from 'dotenv';

dotenv.config();

async function testGeocoding() {
  console.log('Testing enhanced geocoding service...\n');
  
  // Test cases
  const testCases = [
    // Known Denver locations
    {
      description: 'Known Denver location',
      address: 'Union Station, Denver, CO',
      expectedInBounds: true
    },
    {
      description: 'Highlands neighborhood',
      address: 'Highlands',
      expectedInBounds: true
    },
    {
      description: 'LoHi neighborhood',
      address: 'LoHi, Denver',
      expectedInBounds: true
    },
    // Specific venues
    {
      description: 'Specific venue',
      address: 'Root Down, Denver',
      expectedInBounds: true
    },
    {
      description: 'Another specific venue',
      address: 'Avanti Food & Beverage',
      expectedInBounds: true
    },
    // Edge cases
    {
      description: 'Incomplete address',
      address: 'Broadway',
      expectedInBounds: true
    },
    {
      description: 'Outside Denver bounds',
      address: 'Golden, CO',
      expectedInBounds: false
    },
    {
      description: 'Similar name outside Denver',
      address: 'Highland Ranch, CO',
      expectedInBounds: false
    }
  ];

  // Test individual geocoding
  console.log('Testing individual address geocoding:');
  for (const testCase of testCases) {
    console.log(`\nTesting: ${testCase.description}`);
    console.log(`Address: ${testCase.address}`);
    
    try {
      const coordinates = await geocodingService.getCoordinates(testCase.address);
      if (coordinates) {
        console.log('Coordinates:', coordinates);
        // Test if coordinates are the default Denver coordinates
        const isDefault = coordinates[0] === -104.9847 && coordinates[1] === 39.7392;
        if (isDefault) {
          console.log('⚠️  Returned default Denver coordinates');
        }
        // Validate if result matches expected bounds
        const isInDenver = coordinates[1] >= 39.614431 && coordinates[1] <= 39.798058 &&
                          coordinates[0] >= -105.109927 && coordinates[0] <= -104.889197;
        if (isInDenver === testCase.expectedInBounds) {
          console.log('✅ Test passed - bounds check matches expectation');
        } else {
          console.log('❌ Test failed - bounds check does not match expectation');
        }
      } else {
        console.log('❌ Test failed - no coordinates returned');
      }
    } catch (error) {
      console.error('Error testing address:', error);
    }
  }

  // Test batch geocoding
  console.log('\nTesting batch geocoding:');
  const addresses = testCases.map(tc => tc.address);
  try {
    console.log(`Batch geocoding ${addresses.length} addresses...`);
    const results = await geocodingService.batchGeocode(addresses);
    console.log(`✅ Successfully batch geocoded ${results.size} addresses`);
    
    // Verify cache usage
    console.log('\nTesting cache functionality:');
    const start = Date.now();
    const cachedResults = await geocodingService.batchGeocode(addresses);
    const duration = Date.now() - start;
    console.log(`Second batch completed in ${duration}ms`);
    if (duration < 1000) {
      console.log('✅ Cache appears to be working (fast response time)');
    } else {
      console.log('⚠️  Cache might not be working as expected (slow response time)');
    }
  } catch (error) {
    console.error('Error testing batch geocoding:', error);
  }
}

// Run the tests
console.log('Starting geocoding tests...');
testGeocoding().then(() => {
  console.log('\nGeocoding tests completed.');
  process.exit(0);
}).catch((error) => {
  console.error('Error running tests:', error);
  process.exit(1);
}); 