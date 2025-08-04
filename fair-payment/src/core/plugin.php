<?php
namespace FairPayment\Core;

defined( 'WPINC' ) || die;

class Plugin {
	private static $instance = null;

	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	public function init() {
		$this->load_hooks();
	}

	private function load_hooks() {
		new \FairPayment\Hooks\BlockHooks();

		if ( is_admin() ) {
			// new \FairPayment\Hooks\AdminHooks();
		}
	}
}
