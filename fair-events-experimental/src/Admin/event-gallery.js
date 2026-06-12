(function ($) {
	'use strict';

	let mediaFrame;
	const galleryIds = [];

	// Parse existing gallery IDs.
	const idsInput = $('#fair-event-gallery-ids');
	if (idsInput.val()) {
		galleryIds.push(
			...idsInput
				.val()
				.split(',')
				.map((id) => parseInt(id))
		);
	}

	// Open media frame.
	$('#fair-event-gallery-add').on('click', function (e) {
		e.preventDefault();

		if (mediaFrame) {
			mediaFrame.open();
			return;
		}

		mediaFrame = wp.media({
			title: fairEventGallery.addPhotos,
			button: { text: fairEventGallery.selectPhotos },
			multiple: true,
			library: { type: 'image' },
		});

		mediaFrame.on('select', function () {
			const selection = mediaFrame.state().get('selection');

			selection.forEach(function (attachment) {
				attachment = attachment.toJSON();

				if (!galleryIds.includes(attachment.id)) {
					galleryIds.push(attachment.id);
					addPhotoPreview(attachment);
				}
			});

			updateGalleryInput();
			updatePhotoCount();
		});

		mediaFrame.open();
	});

	// Remove photo.
	$(document).on('click', '.fair-event-photo-remove', function () {
		const item = $(this).closest('.fair-event-photo-item');
		const attachmentId = parseInt(item.data('id'));

		const index = galleryIds.indexOf(attachmentId);
		if (index > -1) {
			galleryIds.splice(index, 1);
		}

		item.remove();
		updateGalleryInput();
		updatePhotoCount();
	});

	function addPhotoPreview(attachment) {
		const thumbUrl = attachment.sizes?.thumbnail?.url || attachment.url;
		const html = `
			<div class="fair-event-photo-item" data-id="${attachment.id}" style="position: relative;">
				<img src="${thumbUrl}" alt="${attachment.title}"
					 style="width: 100px; height: 100px; object-fit: cover;" />
				<button type="button" class="fair-event-photo-remove"
						style="position: absolute; top: 5px; right: 5px; background: rgba(0,0,0,0.7); color: white; border: none; border-radius: 3px; cursor: pointer; padding: 2px 6px;"
						title="Remove">×</button>
			</div>
		`;
		$('#fair-event-gallery-preview').append(html);
	}

	function updateGalleryInput() {
		idsInput.val(galleryIds.join(','));
	}

	function updatePhotoCount() {
		const count = galleryIds.length;
		const text =
			count === 1
				? fairEventGallery.photoCount.singular.replace('%d', count)
				: fairEventGallery.photoCount.plural.replace('%d', count);
		$('#fair-event-gallery-count').text(text);
	}
})(jQuery);
