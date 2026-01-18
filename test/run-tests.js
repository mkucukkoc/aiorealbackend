#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class TestRunner {
  constructor() {
    this.testResults = [];
    this.startTime = Date.now();
    this.logFile = path.join(__dirname, 'test-results.log');
  }

  log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;
    console.log(logMessage);
    
    // Write to log file
    fs.appendFileSync(this.logFile, logMessage + '\n');
  }

  async runTestSuite(suiteName, testFile) {
    this.log(`🚀 Starting ${suiteName}...`);
    const suiteStartTime = Date.now();
    
    return new Promise((resolve) => {
      const jest = spawn('npx', ['jest', testFile, '--verbose', '--no-coverage'], {
        cwd: path.join(__dirname, '..'),
        stdio: 'pipe'
      });

      let output = '';
      let errorOutput = '';

      jest.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        process.stdout.write(text);
      });

      jest.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;
        process.stderr.write(text);
      });

      jest.on('close', (code) => {
        const suiteDuration = Date.now() - suiteStartTime;
        const result = {
          suiteName,
          testFile,
          exitCode: code,
          duration: suiteDuration,
          output,
          errorOutput,
          success: code === 0
        };

        this.testResults.push(result);

        if (code === 0) {
          this.log(`✅ ${suiteName} completed successfully in ${suiteDuration}ms`);
        } else {
          this.log(`❌ ${suiteName} failed with exit code ${code} in ${suiteDuration}ms`, 'ERROR');
        }

        resolve(result);
      });
    });
  }

  async runAllTests() {
    this.log('🧪 Starting Comprehensive Test Suite...');
    this.log(`📝 Log file: ${this.logFile}`);

    const testSuites = [
      { name: 'Auth Endpoints', file: 'test/endpoints/auth.test.ts' },
      { name: 'Chat Endpoints', file: 'test/endpoints/chat.test.ts' },
      { name: 'PDF Read Endpoints', file: 'test/endpoints/pdfRead.test.ts' },
      { name: 'Notifications Endpoints', file: 'test/endpoints/notifications.test.ts' },
      { name: 'Performance Tests', file: 'test/performance/load.test.ts' }
    ];

    let totalTests = 0;
    let passedTests = 0;
    let failedTests = 0;

    for (const suite of testSuites) {
      const result = await this.runTestSuite(suite.name, suite.file);
      totalTests++;
      
      if (result.success) {
        passedTests++;
      } else {
        failedTests++;
      }

      // Small delay between test suites
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    this.generateReport(totalTests, passedTests, failedTests);
  }

  generateReport(totalTests, passedTests, failedTests) {
    const totalDuration = Date.now() - this.startTime;
    
    this.log('\n' + '='.repeat(80));
    this.log('📊 COMPREHENSIVE TEST SUITE REPORT');
    this.log('='.repeat(80));
    
    this.log(`⏱️  Total Duration: ${totalDuration}ms (${(totalDuration / 1000).toFixed(2)}s)`);
    this.log(`📈 Total Test Suites: ${totalTests}`);
    this.log(`✅ Passed: ${passedTests}`);
    this.log(`❌ Failed: ${failedTests}`);
    this.log(`📊 Success Rate: ${((passedTests / totalTests) * 100).toFixed(2)}%`);
    
    this.log('\n📋 DETAILED RESULTS:');
    this.log('-'.repeat(80));
    
    this.testResults.forEach((result, index) => {
      const status = result.success ? '✅ PASS' : '❌ FAIL';
      const duration = `${result.duration}ms`;
      this.log(`${index + 1}. ${result.suiteName} - ${status} (${duration})`);
      
      if (!result.success) {
        this.log(`   Error: Exit code ${result.exitCode}`);
        if (result.errorOutput) {
          this.log(`   Error Output: ${result.errorOutput.substring(0, 200)}...`);
        }
      }
    });

    this.log('\n🔍 PERFORMANCE METRICS:');
    this.log('-'.repeat(80));
    
    const performanceTest = this.testResults.find(r => r.suiteName === 'Performance Tests');
    if (performanceTest && performanceTest.success) {
      this.log('✅ Performance tests completed successfully');
      this.log('📊 Check detailed performance metrics in the test output above');
    } else {
      this.log('❌ Performance tests failed or not run');
    }

    this.log('\n📁 LOG FILE LOCATION:');
    this.log(`   ${this.logFile}`);
    
    this.log('\n' + '='.repeat(80));
    
    if (failedTests === 0) {
      this.log('🎉 ALL TESTS PASSED! System is ready for production.');
    } else {
      this.log(`⚠️  ${failedTests} test suite(s) failed. Please review the errors above.`);
    }
    
    this.log('='.repeat(80));

    // Exit with appropriate code
    process.exit(failedTests > 0 ? 1 : 0);
  }
}

// Handle command line arguments
const args = process.argv.slice(2);
const testRunner = new TestRunner();

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
🧪 Avenia Test Runner

Usage:
  node test/run-tests.js [options]

Options:
  --help, -h          Show this help message
  --suite <name>      Run specific test suite
  --performance       Run only performance tests
  --endpoints         Run only endpoint tests

Examples:
  node test/run-tests.js                    # Run all tests
  node test/run-tests.js --suite auth       # Run auth tests only
  node test/run-tests.js --performance      # Run performance tests only
  node test/run-tests.js --endpoints        # Run endpoint tests only
`);
  process.exit(0);
}

if (args.includes('--suite')) {
  const suiteIndex = args.indexOf('--suite');
  const suiteName = args[suiteIndex + 1];
  
  const testSuites = {
    'auth': { name: 'Auth Endpoints', file: 'test/endpoints/auth.test.ts' },
    'chat': { name: 'Chat Endpoints', file: 'test/endpoints/chat.test.ts' },
    'pdf': { name: 'PDF Read Endpoints', file: 'test/endpoints/pdfRead.test.ts' },
    'notifications': { name: 'Notifications Endpoints', file: 'test/endpoints/notifications.test.ts' },
    'performance': { name: 'Performance Tests', file: 'test/performance/load.test.ts' }
  };
  
  const suite = testSuites[suiteName];
  if (suite) {
    testRunner.runTestSuite(suite.name, suite.file).then(() => {
      process.exit(0);
    });
  } else {
    console.error(`❌ Unknown test suite: ${suiteName}`);
    console.error(`Available suites: ${Object.keys(testSuites).join(', ')}`);
    process.exit(1);
  }
} else if (args.includes('--performance')) {
  testRunner.runTestSuite('Performance Tests', 'test/performance/load.test.ts').then(() => {
    process.exit(0);
  });
} else if (args.includes('--endpoints')) {
  const endpointSuites = [
    { name: 'Auth Endpoints', file: 'test/endpoints/auth.test.ts' },
    { name: 'Chat Endpoints', file: 'test/endpoints/chat.test.ts' },
    { name: 'PDF Read Endpoints', file: 'test/endpoints/pdfRead.test.ts' },
    { name: 'Notifications Endpoints', file: 'test/endpoints/notifications.test.ts' }
  ];
  
  (async () => {
    for (const suite of endpointSuites) {
      await testRunner.runTestSuite(suite.name, suite.file);
    }
    process.exit(0);
  })();
} else {
  // Run all tests
  testRunner.runAllTests();
}








