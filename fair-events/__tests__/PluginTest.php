<?php
/**
 * Plugin Core Tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests;

use PHPUnit\Framework\TestCase;
use FairEvents\Core\Plugin;

/**
 * Test Plugin class
 */
class PluginTest extends TestCase {
	/**
	 * Test plugin instance creation
	 *
	 * @return void
	 */
	public function test_plugin_instance() {
		$plugin = Plugin::instance();
		$this->assertInstanceOf( Plugin::class, $plugin );
	}

	/**
	 * Test singleton pattern
	 *
	 * @return void
	 */
	public function test_singleton_pattern() {
		$instance1 = Plugin::instance();
		$instance2 = Plugin::instance();
		$this->assertSame( $instance1, $instance2 );
	}
}
