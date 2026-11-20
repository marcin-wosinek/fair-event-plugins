<?php
/**
 * FakeInstagramPosts test double.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

/**
 * Fair Events Experimental's posting, scripted: each publishing call returns
 * the next queued answer and is logged. Nothing reaches Instagram.
 */
class FakeInstagramPosts {

	/**
	 * Account answered by account().
	 *
	 * @var array
	 */
	public $account = array(
		'usable'       => true,
		'user_id'      => '17841400000000001',
		'username'     => 'fair_demo',
		'message'      => '',
		'settings_url' => 'https://example.test/wp-admin/admin.php?page=fair-events-instagram',
	);

	/**
	 * Result of compose().
	 *
	 * @var array|\WP_Error
	 */
	public $post = array(
		'caption' => "Week\n• Mon, 18:00, Juggling",
		'jpeg'    => 'JPEG',
		'width'   => 1080,
		'height'  => 1350,
	);

	/**
	 * Result of store_image().
	 *
	 * @var array|\WP_Error
	 */
	public $asset = array(
		'path' => '/uploads/fair-events-instagram/abcdefghijklmnopqrstuvwxyz012345.jpg',
		'url'  => 'https://example.test/uploads/fair-events-instagram/abcdefghijklmnopqrstuvwxyz012345.jpg',
	);

	/**
	 * Result of create_container().
	 *
	 * @var array
	 */
	public $container = array(
		'state'   => 'ok',
		'id'      => 'container-1',
		'code'    => '',
		'message' => '',
	);

	/**
	 * Answers of container_status(), in order; the last one repeats.
	 *
	 * @var array[]
	 */
	public $statuses = array();

	/**
	 * Result of publish().
	 *
	 * @var array
	 */
	public $published = array(
		'state'   => 'sent',
		'id'      => 'media-1',
		'code'    => '',
		'message' => '',
	);

	/**
	 * Calls made, as method names.
	 *
	 * @var string[]
	 */
	public $calls = array();

	/**
	 * Called before publish() answers, e.g. to stop the request.
	 *
	 * @var callable|null
	 */
	public $on_publish;

	/**
	 * Connected account.
	 *
	 * @return array
	 */
	public function account() {
		return $this->account;
	}

	/**
	 * Compose a post.
	 *
	 * @param array $summary Summary.
	 * @return array|\WP_Error
	 */
	public function compose( array $summary ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.Found -- scripted fake.
		$this->calls[] = 'compose';
		return $this->post;
	}

	/**
	 * Store an image.
	 *
	 * @param string $jpeg JPEG.
	 * @return array|\WP_Error
	 */
	public function store_image( $jpeg ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.Found -- scripted fake.
		$this->calls[] = 'store_image';
		return $this->asset;
	}

	/**
	 * Create a container.
	 *
	 * @param string $url     Image URL.
	 * @param string $caption Caption.
	 * @return array
	 */
	public function create_container( $url, $caption ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter -- scripted fake.
		$this->calls[] = 'create_container';
		return $this->container;
	}

	/**
	 * Container status.
	 *
	 * @param string $id Container ID.
	 * @return array
	 */
	public function container_status( $id ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.Found -- scripted fake.
		$this->calls[] = 'container_status';
		$status        = count( $this->statuses ) > 1 ? array_shift( $this->statuses ) : $this->statuses[0];
		return $status + array(
			'code'    => '',
			'message' => '',
		);
	}

	/**
	 * Publish.
	 *
	 * @param string $id Container ID.
	 * @return array
	 */
	public function publish( $id ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.Found -- scripted fake.
		$this->calls[] = 'publish';
		if ( $this->on_publish ) {
			call_user_func( $this->on_publish );
		}
		return $this->published;
	}

	/**
	 * Permalink.
	 *
	 * @param string $media_id Media ID.
	 * @return string
	 */
	public function permalink( $media_id ) { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.Found -- scripted fake.
		$this->calls[] = 'permalink';
		return 'https://www.instagram.com/p/ABC123/';
	}

	/**
	 * How many times a method was called.
	 *
	 * @param string $method Method.
	 * @return int
	 */
	public function count( $method ) {
		return count( array_keys( $this->calls, $method, true ) );
	}
}
