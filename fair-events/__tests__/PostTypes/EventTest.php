<?php
/**
 * Event Post Type Tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\PostTypes;

use PHPUnit\Framework\TestCase;
use FairEvents\PostTypes\Event;

/**
 * Test Event post type
 */
class EventTest extends TestCase {
	/**
	 * Test post type constant
	 *
	 * @return void
	 */
	public function test_post_type_constant() {
		$this->assertEquals( 'fair_event', Event::POST_TYPE );
	}

	/**
	 * Test register method exists
	 *
	 * @return void
	 */
	public function test_register_method_exists() {
		$this->assertTrue( method_exists( Event::class, 'register' ) );
	}
}
