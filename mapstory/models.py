from django.conf import settings
from django.core.urlresolvers import reverse
from django.db import models
from django.contrib.auth.models import Group
from datetime import datetime
from geonode.maps.models import Map, MapLayer
import hashlib
import textile
from django.template.defaulttags import register
import os
from django.template.defaultfilters import slugify
from django.db.models import signals
from geonode.people.models import Profile
from geonode.layers.models import Layer
from geonode.groups.models import GroupProfile
from geonode.maps.models import Map
from geonode.people.models import profile_post_save
from guardian.shortcuts import get_objects_for_user
from django.contrib.sites.models import Site
from PIL import Image
from django import forms
from solo.models import SingletonModel
from resizeimage import resizeimage
from django.core.files.base import ContentFile
from io import BytesIO
from journal.models import JournalEntry

from mapstory.notifications import set_mapstory_notifications

set_mapstory_notifications()


class CustomSite(models.Model):
    site = models.OneToOneField(Site, null=True, related_name='assets')
    subtitle = models.CharField(max_length=100)
    logo = models.ImageField(blank=False, upload_to='customsite')
    favicon = models.ImageField(blank=False, upload_to='customsite')
    footer_text = models.TextField()

    class Meta:
        verbose_name = "Custom Site Property"
        verbose_name_plural = "Custom Site Properties"

    def __unicode__(self):
        return 'Properties of {0}'.format(self.site.domain)

    def save(self, *args, **kwargs):
        super(CustomSite, self).save(*args, **kwargs)
        # Cached information will likely be incorrect now.
        Site.objects.clear_cache()


def _stamp(data):
    s = hashlib.sha1()
    s.update(data)
    return s.hexdigest()[0:8]


class Sponsor(models.Model):
    name = models.CharField(max_length=64)
    link = models.URLField(blank=False)
    icon = models.ImageField(blank=False, upload_to='sponsors')
    description = models.TextField(blank=True)
    order = models.IntegerField(blank=True, default=0)
    stamp = models.CharField(max_length=8, blank=True)

    def url(self):
        return self.icon.url + "?" + self.stamp

    def save(self, *args, **kwargs):
        if self.icon.name:
            self.stamp = _stamp(self.icon.read())
        super(Sponsor, self).save(*args, **kwargs)

    def __unicode__(self):
        return 'Sponsor - %s' % self.name

    class Meta:
        ordering = ['order']

    def image_tag(self):
        return u'<img src="%s" />' % self.url()
    image_tag.short_description = 'Image'
    image_tag.allow_tags = True


class ContentMixin(models.Model):
    content = models.TextField(
        help_text="use <a href=%s target='_'>textile</a> for the content" %
        'http://redcloth.org/hobix.com/textile/'
    )
    date = models.DateTimeField(default=datetime.now)
    publish = models.BooleanField(default=False)

    def html(self):
        return textile.textile(self.content)

    class Meta:
        abstract = True
        ordering = ['-date']


class Community(models.Model):
    name = models.CharField(max_length=64, unique=True)
    icon = models.ImageField(blank=False, upload_to='communities')
    description = models.TextField(blank=True)
    order = models.IntegerField(blank=True, default=0)
    stamp = models.CharField(max_length=8, blank=True)
    slug = models.SlugField(max_length=64, unique=True, blank=True)
    layer = models.ManyToManyField(Layer, blank=True)
    leads = models.ManyToManyField(Profile, blank=True)
    journals = models.ManyToManyField(JournalEntry, blank=True)

    def url(self):
        return self.icon.url + "?" + self.stamp

    def save(self, *args, **kwargs):
        if self.icon.name:
            self.stamp = _stamp(self.icon.read())
        super(Community, self).save(*args, **kwargs)

    def __unicode__(self):
        return 'Community - %s' % self.name

    class Meta:
        ordering = ['order']
        verbose_name_plural = 'communities'

    def image_tag(self):
        return u'<img src="%s" />' % self.url()
    image_tag.short_description = 'Image'
    image_tag.allow_tags = True


class Task(models.Model):
    task = models.TextField(blank=True)
    community = models.ForeignKey(Community, related_name='tasks')


def name_post_save(instance, *args, **kwargs):
    Community.objects.filter(name=instance.name).update(slug=(slugify(instance.name)))


class NewsItem(ContentMixin ):
    title = models.CharField(max_length=64)

    @property
    def publication_time(self):
        return self.date


class GetPage(models.Model):
    name = models.SlugField(max_length=32, unique=True,
                            help_text='Do NOT include the "get" prefix')
    title = models.CharField(max_length=32)
    subtitle = models.CharField(max_length=32, blank=True)

    def published_entries(self):
        return self.contents.filter(publish=True)

    def __unicode__(self):
        return 'GetPage: %s' % self.name


class GetPageContent(ContentMixin):
    title = models.CharField(max_length=64)
    subtitle = models.CharField(max_length=64, blank=True)
    example_map = models.ForeignKey(Map, null=True, blank=True)
    main_link = models.URLField(blank=False)
    external_link = models.URLField(blank=True)
    external_link_title = models.CharField(max_length=64, blank=True, null=True)
    page = models.ForeignKey(GetPage, related_name='contents')
    order = models.IntegerField(blank=True, default=0)
    video = models.FileField(upload_to='getpage', blank=True)
    video_embed_link = models.URLField(blank=True)

    def extension(self):
        if self.video.name is None:
            return 'mp4'
        name, extension = os.path.splitext(self.video.name)
        return extension[1:]

    class Meta:
        ordering = ['order']


class Leader(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL)
    content = models.TextField()

    def html(self):
        return textile.textile(self.content)


class ParallaxImage(models.Model):
    name = models.CharField(max_length=64, blank=True)
    image = models.ImageField(upload_to='parallax', max_length=255)

    def __unicode__(self):
        return self.image.url


class ThumbnailImage(SingletonModel):
    thumbnail_image = models.ImageField(
        upload_to=os.path.join(settings.MEDIA_ROOT, 'thumbs'),
    )

    def save(self, *args, **kwargs):
        pil_image_obj = Image.open(self.thumbnail_image)
        new_image = resizeimage.resize_cover(
            pil_image_obj,
            [250, 150],
            validate=False
        )

        new_image_io = BytesIO()
        new_image.save(new_image_io, format='PNG')

        temp_name = self.thumbnail_image.name
        self.thumbnail_image.delete(save=False)

        self.thumbnail_image.save(
            temp_name,
            content=ContentFile(new_image_io.getvalue()),
            save=False
        )

        super(ThumbnailImage, self).save(*args, **kwargs)


class ThumbnailImageForm(forms.Form):
    thumbnail_image = forms.FileField(
        label='Select a file',
    )


def get_images():
    return ParallaxImage.objects.all()


def get_sponsors():
    return Sponsor.objects.filter(order__gte=0)


def get_featured_groups():
    return GroupProfile.objects.filter(featured=True)


def get_group_layers(gProfile):
    users = gProfile.group.user_set.all()
    layers = []
    for user in users:
        layers.append(get_objects_for_user(user, 'base.view_resourcebase').instance_of(Layer))

    return [item for sublist in layers for item in sublist]


def get_group_maps(gProfile):
    users = gProfile.group.user_set.all()
    maps = []
    for user in users:
        maps.append(get_objects_for_user(user, 'base.view_resourcebase').instance_of(Map))

    return [item for sublist in maps for item in sublist]


def mapstory_profile_post_save(instance, sender, **kwargs):
    profile_post_save(instance, sender, **kwargs)
    registered_group, created = Group.objects.get_or_create(name='registered')
    instance.groups.add(registered_group)
    Profile.objects.filter(id=instance.id).update()

signals.post_save.connect(name_post_save, sender=Community)
signals.post_save.connect(mapstory_profile_post_save, sender=Profile)
